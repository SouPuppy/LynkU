import { AccountRestrictionFailure } from '@lynku/server'
// cloud function: posts — Post reads, writes, moderation, and counters
import * as cloud from 'wx-server-sdk'
import { wechatTextSafety } from '@lynku/adapters'
import { ModerationFailure, PostAuthorFailure } from '@lynku/server'
import { connectDatabase, CLOUD_DATABASE_OPTIONS, text, type Row } from '../common/database'
import type { PublicPostRequest } from '@lynku/contracts'
import type { CloudEvent } from '../common'
import type { OwnedPostStore, PublicPostStore, PostReadStore, PostCreateStore, PostUpdateStore, PostStatusStore } from '@lynku/server'
cloud.init()
const db = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
const _ = db.command
import {
  ok,
  fail,
  stableDocumentId,
  authorizeAction,
  checkAdmin,
  checkRateLimit,
  withAuth,
} from '../common'
import { createUserPost, PostCreateFailure, updateUserPost, PostUpdateFailure, deleteUserPost, PostStatusFailure, readPost, PostReadFailure } from '@lynku/server'

import { listOwnedPosts, listPublicPosts } from '@lynku/server'

export const main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'posts', event.action)
  if (!authorization.allowed) return authorization.response
  switch (event.action) {
    case 'listMine': return listMine(openid, event)
    case 'list': return listPosts(event.public_only ? '' : openid, event)
    case 'get': return getPost(event.public_only ? '' : openid, event)
    case 'create': return createPost(openid, event, authorization.user)
    case 'search': return listPosts(event.public_only ? '' : openid, event)
    case 'delete': return deletePost(openid, event.post_id, authorization.user)
    case 'update': return updatePost(openid, event, authorization.user)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})

async function categorySnapshots(categoryIds: unknown[]) {
  const ids = Array.from(new Set(categoryIds.map(value => {
    if (typeof value !== 'string') throw Error('Invalid post category identity')
    return value
  }).filter(Boolean)))
  const snapshots = new Map<string, Row>()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    const result = await db.collection('categories')
      .where({ _id: _.in(batch) })
      .field({ _id: true, name: true })
      .get()
    for (const category of result.data) {
      snapshots.set(text(category._id), { _id: text(category._id), name: text(category.name) })
    }
  }
  return snapshots
}

function attachCategory(post: Row, snapshots: Map<string, Row>) {
  const category = post.category || (typeof post.category_id === 'string' ? snapshots.get(post.category_id) : undefined)
  return category ? { ...post, category } : post
}

async function listMine(openid: string, event: CloudEvent) {
  if (event.public_only) return fail('公开浏览不能读取私人列表', 'FORBIDDEN')
  const base = { status: _.in(['published', 'flagged']), _openid: openid }
  const store: OwnedPostStore = {
    identifier: stableDocumentId,
    async list(owner, cursor, take) {
      if (owner !== openid) throw Error('Owned list identity mismatch')
      const conditions = cursor ? _.and([base, _.or([
        { created_at: _.lt(new Date(cursor.createdAt)) },
        { created_at: new Date(cursor.createdAt), _id: _.lt(cursor.id) },
      ])]) : base
      return (await db.collection('posts').where(conditions)
        .orderBy('created_at', 'desc').orderBy('_id', 'desc').limit(take).get()).data
    },
    async count() { return (await db.collection('posts').where(base).count()).total },
  }
  try { return ok(await listOwnedPosts(store, openid, event)) } catch (error) {
    return fail('帖子加载失败', error instanceof PostReadFailure ? error.code : 'QUERY_ERROR')
  }
}

function publicPostStore(): PublicPostStore {
  function conditions(request: PublicPostRequest) {
    const base: Row = { status: 'published' }
    if (request.categoryId) base.category_id = request.categoryId
    if (request.authorId) { base._openid = request.authorId; base.anonymous = false }
    if (!request.query) return base
    const escaped = request.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return _.and([base, _.or([
      { title: db.RegExp({ regexp: escaped, options: 'i' }) },
      { content: db.RegExp({ regexp: escaped, options: 'i' }) },
    ])])
  }
  return {
    identifier: stableDocumentId,
    async list(request, take) {
      const base = conditions(request), cursor = request.cursor
      const where = cursor ? _.and([base, _.or([
        { created_at: _.lt(new Date(cursor.createdAt)) },
        { created_at: new Date(cursor.createdAt), _id: _.lt(cursor.id) },
      ])]) : base
      const page = await db.collection('posts').where(where).orderBy('created_at', 'desc').orderBy('_id', 'desc').limit(take).get()
      const categories = await categorySnapshots(page.data.map(post => post.category_id))
      return page.data.map(post => attachCategory(post, categories))
    },
    async count(request) { return (await db.collection('posts').where(conditions(request)).count()).total },
  }
}
async function listPosts(openid: string, event: CloudEvent) {
  try { return ok(await listPublicPosts(publicPostStore(), openid, event, event.action === 'search')) } catch (error) {
    return fail('帖子加载失败', error instanceof PostReadFailure ? error.code : 'QUERY_ERROR')
  }
}

async function getPost(openid: string, event: unknown) {
  const store: PostReadStore = {
    async post(id) { return (await db.collection('posts').doc(id).get()).data },
    async isAdmin(viewer) {
      return checkAdmin(db, viewer)
    },
    async incrementView(id) { await db.collection('posts').doc(id).update({ data: { view_count: _.inc(1) } }) },
  }
  try { return ok({ post: await readPost(store, openid, event) }) } catch (error) {
    if (error instanceof PostReadFailure) return fail({ INVALID_INPUT: '帖子参数无效', NOT_FOUND: '帖子不存在', FORBIDDEN: '无权操作' }[error.code], error.code)
    return fail('帖子加载失败', 'QUERY_ERROR')
  }
}

async function createPost(openid: string, event: unknown, principal: Row | undefined) {
  if (!principal || typeof principal._id !== 'string') return fail('身份服务暂时不可用', 'AUTH_UNAVAILABLE')
  const accountId = principal._id
  let rateFailure: ReturnType<typeof fail> | null = null
  const store: PostCreateStore = {
    async existing(id) { return (await db.collection('posts').doc(id).get()).data },
    identifier: stableDocumentId,
    now: () => new Date().toISOString(),
    moderate: wechatTextSafety(input => cloud.openapi.security.msgSecCheck(input), openid, 3),
    async allowCreate() {
      const rate = await checkRateLimit(db, openid, 'posts:create', { limit: 10, windowMs: 3600000 })
      if (!rate.allowed) {
        rateFailure = fail('暂时无法发布，请稍后重试', rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
        throw new Error('Create rate rejected')
      }
    },
    run(operation) {
      return db.runTransaction(transaction => operation({
        author: async () => (await transaction.collection('users').doc(accountId).get()).data,
        async post(id) { return (await transaction.collection('posts').doc(id).get()).data },
        async category(id) { return (await transaction.collection('categories').doc(id).get()).data },
        async putPost(id, row) {
          const { _id, ...data } = row
          await transaction.collection('posts').doc(id).set({ data: { ...data,
            created_at: new Date(text(data.created_at)), updated_at: new Date(text(data.updated_at)) } })
        },
        async setCategoryCount(id, count) { await transaction.collection('categories').doc(id).update({ data: { post_count: count } }) },
      }))
    },
  }
  try { return ok(await createUserPost(store, openid, event)) } catch (error) {
    if (error instanceof AccountRestrictionFailure) return fail(error.message, error.code)
    if (error instanceof PostAuthorFailure) return fail('账号状态已变更，请刷新后重试', error.code)
    if (error instanceof ModerationFailure) return fail(error.code === 'CONTENT_REJECTED' ? '内容未通过审核，请修改后提交' : '审核服务暂不可用，请稍后重试', error.code)
    if (rateFailure) return rateFailure
    if (error instanceof PostCreateFailure) return fail({ INVALID_INPUT: '发布参数无效', INVALID_CATEGORY: '分类不存在',
      CONFLICT: '相同请求ID不能用于不同内容' }[error.code], error.code)
    return fail('发布结果未确认，请重试', 'CREATE_ERROR')
  }
}

const statusStore: PostStatusStore = {
  now: () => new Date().toISOString(),
  async existing(id) { return (await db.collection('posts').doc(id).get()).data },
  run(operation) {
    return db.runTransaction(transaction => operation({
      audit: event => transaction.collection('audit_events').doc(stableDocumentId('audit:post', event.target, String(event.revision))).set({
        data: { ...event, action: 'post.status', at: new Date(event.at) },
      }),
      async post(id) { return (await transaction.collection('posts').doc(id).get()).data },
      async category(id) { return (await transaction.collection('categories').doc(id).get()).data },
      async setStatus(id, status, revision, updatedAt) {
        await transaction.collection('posts').doc(id).update({ data: { status, revision, updated_at: new Date(updatedAt) } })
      },
      async setCategoryCount(id, count) { await transaction.collection('categories').doc(id).update({ data: { post_count: count } }) },
    }))
  },
}
function statusError(error: unknown, fallback: string) {
  if (error instanceof PostStatusFailure) return fail({ INVALID_INPUT: '帖子参数无效', NOT_FOUND: '帖子不存在',
    FORBIDDEN: '无权操作', INVALID_CATEGORY: '分类状态不可用' }[error.code], error.code)
  return fail('帖子操作失败，请重试', fallback)
}
async function deletePost(openid: string, postId: unknown, principal: Row | undefined) {
  try {
    await deleteUserPost(statusStore, { id: openid, isAdmin: principal?.verified === true && principal?.role === 'admin' }, postId)
    return ok({ deleted: true })
  } catch (error) { return statusError(error, 'DELETE_ERROR') }
}

async function updatePost(openid: string, event: unknown, principal: Row | undefined) {
  if (!principal || typeof principal._id !== 'string') return fail('身份服务暂时不可用', 'AUTH_UNAVAILABLE')
  const accountId = principal._id
  let rateFailure: ReturnType<typeof fail> | null = null
  const store: PostUpdateStore = {
    identifier: stableDocumentId, now: () => new Date().toISOString(), moderate: wechatTextSafety(input => cloud.openapi.security.msgSecCheck(input), openid, 3),
    async existing(id) { return (await db.collection('posts').doc(id).get()).data },
    async allowUpdate() {
      const rate = await checkRateLimit(db, openid, 'posts:update', { limit: 30, windowMs: 3600000 })
      if (!rate.allowed) {
        rateFailure = fail('暂时无法修改，请稍后重试', rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
        throw new Error('Update rate rejected')
      }
    },
    run(operation) {
      return db.runTransaction(transaction => operation({
        author: async () => (await transaction.collection('users').doc(accountId).get()).data,
        async post(id) { return (await transaction.collection('posts').doc(id).get()).data },
        async category(id) { return (await transaction.collection('categories').doc(id).get()).data },
        async updatePost(id, changes) { await transaction.collection('posts').doc(id).update({ data: {
          ...changes, updated_at: new Date(text(changes.updated_at)),
        } }) },
        async setCategoryCount(id, count) { await transaction.collection('categories').doc(id).update({ data: { post_count: count } }) },
      }))
    },
  }
  try { return ok(await updateUserPost(store, openid, event)) } catch (error) {
    if (error instanceof AccountRestrictionFailure) return fail(error.message, error.code)
    if (error instanceof PostAuthorFailure) return fail('账号状态已变更，请刷新后重试', error.code)
    if (error instanceof ModerationFailure) return fail(error.code === 'CONTENT_REJECTED' ? '内容未通过审核，请修改后提交' : '审核服务暂不可用，请稍后重试', error.code)
    if (rateFailure) return rateFailure
    if (error instanceof PostUpdateFailure) return fail({ INVALID_INPUT: '修改参数无效', INVALID_CATEGORY: '分类不存在',
      NOT_FOUND: '帖子不存在', FORBIDDEN: '无权操作', CONFLICT: '帖子版本冲突，请保留当前内容后重新加载' }[error.code], error.code)
    return fail('修改结果未确认，请重试', 'UPDATE_ERROR')
  }
}
