// cloud function: posts — Post reads, writes, moderation, and counters
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database({ throwOnNotFound: false })
const _ = db.command
const {
  ok,
  fail,
  validateInput,
  stableDocumentId,
  filterSensitiveWords,
  authorizeAction,
  authorSnapshot,
  checkRateLimit,
  withAuth,
} = require('../common')
const { createUserPost, PostCreateFailure, updateUserPost, PostUpdateFailure, deleteUserPost, moderatePost, PostStatusFailure, projectPost, readPost, PostReadFailure } = require('@lucky/server')

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const { listOwnedPosts } = require('@lucky/server')

exports.main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'posts', event.action)
  if (!authorization.allowed) return authorization.response
  switch (event.action) {
    case 'listMine': return listMine(openid, event)
    case 'list': return listPosts(event.public_only ? '' : openid, event)
    case 'get': return getPost(event.public_only ? '' : openid, event)
    case 'create': return createPost(openid, event, authorization.user)
    case 'search': return searchPosts(event.public_only ? '' : openid, event)
    case 'delete': return deletePost(openid, event.post_id, authorization.user)
    case 'update': return updatePost(openid, event, authorization.user)
    case 'flag': return flagPost(openid, event.post_id, event.flagged, authorization.user)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})

function pagination(offset, limit) {
  const parsedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0
  const parsedLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_LIMIT)
    : DEFAULT_LIMIT
  return { offset: parsedOffset, limit: parsedLimit }
}

function sanitizePost(post, viewerOpenid) { return projectPost(post, viewerOpenid) }

async function categorySnapshots(categoryIds) {
  const ids = Array.from(new Set(categoryIds.filter(Boolean)))
  const snapshots = new Map()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    const result = await db.collection('categories')
      .where({ _id: _.in(batch) })
      .field({ _id: true, name: true })
      .get()
    for (const category of result.data) {
      snapshots.set(category._id, { _id: category._id, name: category.name })
    }
  }
  return snapshots
}

function attachCategory(post, snapshots) {
  const category = post.category || snapshots.get(post.category_id)
  return category ? { ...post, category } : post
}

async function listMine(openid, event) {
  if (event.public_only) return fail('公开浏览不能读取私人列表', 'FORBIDDEN')
  const base = { status: _.in(['published', 'flagged']), _openid: openid }
  const store = {
    identifier: stableDocumentId,
    async list(owner, cursor, take) {
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

async function listPosts(openid, event) {
  const { offset, limit } = pagination(event.offset, event.limit)
  const conditions = { status: 'published' }
  if (typeof event.category_id === 'string' && event.category_id) {
    conditions.category_id = event.category_id
  }
  if (typeof event.author_openid === 'string' && event.author_openid) {
    conditions._openid = event.author_openid
    conditions.anonymous = false
  }

  try {
    const collection = db.collection('posts')
    const [page, count] = await Promise.all([
      collection.where(conditions).orderBy('created_at', 'desc').skip(offset).limit(limit).get(),
      collection.where(conditions).count(),
    ])
    const categories = await categorySnapshots(page.data.map(post => post.category_id))
    return ok({
      items: page.data.map(post => sanitizePost(attachCategory(post, categories), openid)),
      total: count.total,
      hasMore: offset + page.data.length < count.total,
    })
  } catch (error) {
    console.error('[posts] list failed:', error.message || error)
    return fail('帖子加载失败', 'QUERY_ERROR')
  }
}

async function getPost(openid, event) {
  const store = {
    async post(id) { return (await db.collection('posts').doc(id).get()).data },
    async isAdmin(viewer) {
      const result = await db.collection('users').where({ _openid: viewer }).limit(1).get()
      return result.data[0]?.role === 'admin'
    },
    async incrementView(id) { await db.collection('posts').doc(id).update({ data: { view_count: _.inc(1) } }) },
  }
  try { return ok({ post: await readPost(store, openid, event) }) } catch (error) {
    if (error instanceof PostReadFailure) return fail({ INVALID_INPUT: '帖子参数无效', NOT_FOUND: '帖子不存在', FORBIDDEN: '无权操作' }[error.code], error.code)
    return fail('帖子加载失败', 'QUERY_ERROR')
  }
}

async function createPost(openid, event, principal) {
  let rateFailure = null
  const store = {
    async existing(id) { return (await db.collection('posts').doc(id).get()).data },
    identifier: stableDocumentId,
    now: () => new Date().toISOString(),
    moderate: filterSensitiveWords,
    async allowCreate() {
      const rate = await checkRateLimit(db, openid, 'posts:create', { limit: 10, windowMs: 3600000 })
      if (!rate.allowed) {
        rateFailure = fail('暂时无法发布，请稍后重试', rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
        throw new Error('Create rate rejected')
      }
    },
    run(operation) {
      return db.runTransaction(transaction => operation({
        async post(id) { return (await transaction.collection('posts').doc(id).get()).data },
        async category(id) { return (await transaction.collection('categories').doc(id).get()).data },
        async putPost(id, row) {
          const { _id, ...data } = row
          await transaction.collection('posts').doc(id).set({ data: { ...data,
            created_at: new Date(data.created_at), updated_at: new Date(data.updated_at) } })
        },
        async setCategoryCount(id, count) { await transaction.collection('categories').doc(id).update({ data: { post_count: count } }) },
      }))
    },
  }
  try { return ok(await createUserPost(store, openid, authorSnapshot(principal, openid), event)) } catch (error) {
    if (rateFailure) return rateFailure
    if (error instanceof PostCreateFailure) return fail({ INVALID_INPUT: '发布参数无效', INVALID_CATEGORY: '分类不存在',
      CONFLICT: '相同请求ID不能用于不同内容' }[error.code], error.code)
    return fail('发布结果未确认，请重试', 'CREATE_ERROR')
  }
}

async function searchPosts(openid, event) {
  const queryValidation = validateInput(event.query, { minLen: 1, maxLen: 200 })
  if (!queryValidation.valid) return fail(queryValidation.error, 'INVALID_INPUT')
  const { offset, limit } = pagination(event.offset, event.limit)
  const escaped = queryValidation.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const conditions = _.and([
    { status: 'published' },
    _.or([
      { title: db.RegExp({ regexp: escaped, options: 'i' }) },
      { content: db.RegExp({ regexp: escaped, options: 'i' }) },
    ]),
  ])

  try {
    const collection = db.collection('posts')
    const [page, count] = await Promise.all([
      collection.where(conditions).orderBy('created_at', 'desc').skip(offset).limit(limit).get(),
      collection.where(conditions).count(),
    ])
    const categories = await categorySnapshots(page.data.map(post => post.category_id))
    return ok({
      items: page.data.map(post => sanitizePost(attachCategory(post, categories), openid)),
      total: count.total,
      hasMore: offset + page.data.length < count.total,
    })
  } catch (error) {
    console.error('[posts] search failed:', error.message || error)
    return fail('搜索失败', 'SEARCH_ERROR')
  }
}

const statusStore = {
  now: () => new Date().toISOString(),
  async existing(id) { return (await db.collection('posts').doc(id).get()).data },
  run(operation) {
    return db.runTransaction(transaction => operation({
      async post(id) { return (await transaction.collection('posts').doc(id).get()).data },
      async category(id) { return (await transaction.collection('categories').doc(id).get()).data },
      async setStatus(id, status, revision, updatedAt) {
        await transaction.collection('posts').doc(id).update({ data: { status, revision, updated_at: new Date(updatedAt) } })
      },
      async setCategoryCount(id, count) { await transaction.collection('categories').doc(id).update({ data: { post_count: count } }) },
    }))
  },
}
function statusError(error, fallback) {
  if (error instanceof PostStatusFailure) return fail({ INVALID_INPUT: '帖子参数无效', NOT_FOUND: '帖子不存在',
    FORBIDDEN: '无权操作', INVALID_CATEGORY: '分类状态不可用' }[error.code], error.code)
  return fail('帖子操作失败，请重试', fallback)
}
async function deletePost(openid, postId, principal) {
  try {
    await deleteUserPost(statusStore, { id: openid, isAdmin: principal?.role === 'admin' }, postId)
    return ok({ deleted: true })
  } catch (error) { return statusError(error, 'DELETE_ERROR') }
}

async function updatePost(openid, event, principal) {
  let rateFailure = null
  const store = {
    identifier: stableDocumentId, now: () => new Date().toISOString(), moderate: filterSensitiveWords,
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
        async post(id) { return (await transaction.collection('posts').doc(id).get()).data },
        async category(id) { return (await transaction.collection('categories').doc(id).get()).data },
        async updatePost(id, changes) { await transaction.collection('posts').doc(id).update({ data: {
          ...changes, updated_at: new Date(changes.updated_at),
        } }) },
        async setCategoryCount(id, count) { await transaction.collection('categories').doc(id).update({ data: { post_count: count } }) },
      }))
    },
  }
  try { return ok(await updateUserPost(store, openid, authorSnapshot(principal, openid), event)) } catch (error) {
    if (rateFailure) return rateFailure
    if (error instanceof PostUpdateFailure) return fail({ INVALID_INPUT: '修改参数无效', INVALID_CATEGORY: '分类不存在',
      NOT_FOUND: '帖子不存在', FORBIDDEN: '无权操作', CONFLICT: '帖子版本冲突，请保留当前内容后重新加载' }[error.code], error.code)
    return fail('修改结果未确认，请重试', 'UPDATE_ERROR')
  }
}

async function flagPost(openid, postId, flagged, principal) {
  try {
    await moderatePost(statusStore, { id: openid, isAdmin: principal?.role === 'admin' }, postId, flagged)
    return ok({ flagged })
  } catch (error) { return statusError(error, 'OPERATION_ERROR') }
}
