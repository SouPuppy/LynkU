import { AccountRestrictionFailure } from '@lynku/server'
// cloud function: comments — Comment reads, writes, nesting, and notifications
import * as cloud from 'wx-server-sdk'
import { wechatTextSafety } from '@lynku/adapters'
import { ModerationFailure } from '@lynku/server'
import { connectDatabase, CLOUD_DATABASE_OPTIONS, text, type Row, type CloudTransaction } from '../common/database'
cloud.init()
const db = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
const _ = db.command
import {
  ok,
  fail,
  stableDocumentId,
  nextNonnegativeCount,
  claimOutboxEvent,
  outboxCandidates,
  finishOutboxEvent,
  checkAdmin,
  authorizeAction,
  checkRateLimit,
  withAuth,
  withScheduledDrain,
} from '../common'

import { readCommentHistory, readCommentChanges, CommentReadFailure, createUserComment, deleteUserComment, CommentWriteFailure, nextCommentSequence,
  commentNotificationEvents, deliverCommentNotification, type CommentReadStore, type CommentWriteStore } from '@lynku/server'

const authenticated = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'comments', event.action)
  if (!authorization.allowed) return authorization.response
  switch (event.action) {
    case 'list': return listComments(event.public_only ? '' : openid, event)
    case 'syncChanges': return syncCommentChanges(event.public_only ? '' : openid, event)
    case 'create': return createComment(openid, event, authorization.user)
    case 'delete': return deleteComment(openid, event.comment_id)
    case 'drainOutbox': return drainNotificationOutbox()
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})
export const main = withScheduledDrain(cloud, authenticated, 'notification-outbox', () => drainNotificationOutbox())

const commentReadStore: CommentReadStore = {
  post: async id => (await db.collection('posts').doc(id).get()).data,
  counter: async id => (await db.collection('comment_counters').doc(id).get()).data,
  comment: async id => (await db.collection('comments').doc(id).get()).data,
  async history(postId, cursor, take) {
    const base = { post_id: postId, status: _.in(['published', 'deleted']) }
    const where = cursor ? _.and([base, _.or([
      { created_at: _.gt(new Date(cursor.created_at)) },
      { created_at: new Date(cursor.created_at), _id: _.gt(cursor.id) },
    ])]) : base
    return (await db.collection('comments').where(where).orderBy('created_at', 'asc').orderBy('_id', 'asc').limit(take).get()).data
  },
  async count(postId) { return (await db.collection('comments').where({ post_id: postId, status: _.in(['published', 'deleted']) }).count()).total },
  async changes(postId, after, take) {
    return (await db.collection('comment_changes').where({ post_id: postId, sequence: _.gt(after) }).orderBy('sequence', 'asc').limit(take).get()).data
  },
}
async function listComments(openid: string, event: unknown) {
  try { return ok(await readCommentHistory(commentReadStore, openid, event)) }
  catch (error) { return fail('评论加载失败', error instanceof CommentReadFailure ? error.code : 'QUERY_ERROR') }
}
async function syncCommentChanges(openid: string, event: unknown) {
  try { return ok(await readCommentChanges(commentReadStore, openid, event)) }
  catch (error) { return fail('评论同步失败', error instanceof CommentReadFailure ? error.code : 'QUERY_ERROR') }
}

class CommentRateFailure extends Error {
  constructor(readonly code: 'RATE_LIMIT_UNAVAILABLE' | 'RATE_LIMITED') { super(code) }
}
function commentStore(openid: string): CommentWriteStore {
  return {
    existing: async id => (await db.collection('comments').doc(id).get()).data,
    identifier: stableDocumentId,
    now: () => new Date().toISOString(),
    moderate: wechatTextSafety(input => cloud.openapi.security.msgSecCheck(input), openid, 2),
    allowCreate: async () => {
      const rate = await checkRateLimit(db, openid, 'comments:create', { limit: 60, windowMs: 3600000 })
      if (!rate.allowed) {
        throw new CommentRateFailure(rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
      }
    },
    run: work => db.runTransaction(transaction => work({
      audit: event => transaction.collection('audit_events').doc(stableDocumentId('audit:comment:delete', event.target)).set({
        data: { ...event, action: 'comment.delete', after: 'deleted', at: new Date(event.at) },
      }),
      comment: async id => (await transaction.collection('comments').doc(id).get()).data,
      post: async id => (await transaction.collection('posts').doc(id).get()).data,
      account: async id => (await transaction.collection('users').doc(id).get()).data,
      create: (id, record) => {
        const { _id, ...fields } = record
        return transaction.collection('comments').doc(id).set({ data: { ...fields, created_at: new Date(text(fields.created_at)) } })
      },
      remove: (id, timestamp) => transaction.collection('comments').doc(id).update({ data: {
        status: 'deleted', content: '', updated_at: new Date(timestamp),
      } }),
      adjustPostCount: (id, delta) => adjustCommentCount(transaction, id, delta),
      appendChange: (postId, commentId, type) => recordCommentChange(transaction, postId, commentId, type),
      enqueue: (comment, post, parent) => enqueueCommentNotifications(transaction, comment, post, parent),
    })),
  }
}

async function createComment(openid: string, event: unknown, principal: Row | undefined) {
  try {
    if (!principal) return fail('身份服务暂时不可用', 'AUTH_UNAVAILABLE')
    const { outboxIds, ...receipt } = await createUserComment(commentStore(openid), openid, text(principal._id), event)
    if (outboxIds.length) {
      try { await drainNotificationOutbox(outboxIds) } catch (_) { console.warn('[comments] notification delivery deferred') }
    }
    return ok(receipt)
  } catch (error) {
    if (error instanceof ModerationFailure) return fail(error.code === 'CONTENT_REJECTED' ? '内容未通过审核，请修改后提交' : '审核服务暂不可用，请稍后重试', error.code)
    if (error instanceof AccountRestrictionFailure) return fail(error.message, error.code)
    const code = error instanceof CommentWriteFailure || error instanceof CommentRateFailure
      ? error.code : 'CREATE_ERROR'
    return fail('评论未完成，请重试', code)
  }
}

async function deleteComment(openid: string, commentId: unknown) {
  try { return ok(await deleteUserComment(commentStore(openid), openid, await checkAdmin(db, openid), commentId)) }
  catch (error) { return fail('删除未完成，请重试', error instanceof CommentWriteFailure ? error.code : 'DELETE_ERROR') }
}

async function adjustCommentCount(transaction: CloudTransaction, postId: string, delta: number) {
  const ref = transaction.collection('posts').doc(postId)
  const result = await ref.get()
  if (!result.data) throw new Error(`Post not found: ${postId}`)
  if (typeof result.data.comment_count !== 'number') throw Error('Invalid comment count')
  const next = nextNonnegativeCount(result.data.comment_count, delta)
  await ref.update({ data: { comment_count: next, updated_at: db.serverDate() } })
}

async function recordCommentChange(transaction: CloudTransaction, postId: string, commentId: string, type: 'created' | 'deleted') {
  const counter = transaction.collection('comment_counters').doc(postId)
  const current = (await counter.get()).data
  const sequence = nextCommentSequence(current)
  await counter.set({ data: { post_id: postId, sequence, updated_at: db.serverDate() } })
  await transaction.collection('comment_changes').doc(stableDocumentId('comment:change', postId, String(sequence))).set({
    data: { post_id: postId, sequence, comment_id: commentId, type, created_at: db.serverDate() },
  })
}

async function enqueueCommentNotifications(transaction: CloudTransaction, comment: Row, post: Row, parentComment: Row | null) {
  const notifications = commentNotificationEvents(comment, post, parentComment)
  const ids = []
  for (const notification of notifications) {
    const id = stableDocumentId('notification:outbox', notification.type, notification.to, text(comment._id))
    await transaction.collection('notification_outbox').doc(id).set({
      data: {
        notification,
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: Date.now(),
        created_at: db.serverDate(),
      },
    })
    ids.push(id)
  }
  return ids
}

async function drainNotificationOutbox(ids?: string[]) {
  const candidates = Array.isArray(ids) ? ids : await outboxCandidates(db, 'notification_outbox')
  const results = await Promise.allSettled(candidates.map(async id => {
    const claimed = await claimOutboxEvent(db, 'notification_outbox', id)
    if (!claimed) return false
    try {
      await createNotification(claimed.event.notification)
      return await finishOutboxEvent(db, 'notification_outbox', id, claimed.attemptCount, true)
    } catch (error) {
      await finishOutboxEvent(db, 'notification_outbox', id, claimed.attemptCount, false)
      throw error
    }
  }))
  for (const result of results) {
    if (result.status === 'rejected') console.error('[comments] outbox delivery deferred')
  }
  return ok({
    attempted: candidates.length,
    delivered: results.filter(result => result.status === 'fulfilled' && result.value).length,
    failed: results.filter(result => result.status === 'rejected').length,
  })
}

async function createNotification(notification: unknown) {
  if (!notification || typeof notification !== 'object' || !('actor' in notification)
    || !notification.actor || typeof notification.actor !== 'object' || !('_openid' in notification.actor)
    || typeof notification.actor._openid !== 'string') throw Error('Invalid notification actor')
  const actorId = notification.actor._openid
  const profiles = (await db.collection('users').where({ _openid: actorId }).limit(2).get()).data
  const accountId = profiles.length === 1 ? text(profiles[0]!._id) : null
  return deliverCommentNotification({
    identifier: stableDocumentId,
    now: () => db.serverDate(),
    run: work => db.runTransaction(transaction => work({
      read: async id => (await transaction.collection('notifications').doc(id).get()).data,
      put: (id, data) => transaction.collection('notifications').doc(id).set({ data }),
      remove: async id => { await transaction.collection('notifications').doc(id).remove() },
      source: async (postId, commentId) => {
        const post = (await transaction.collection('posts').doc(postId).get()).data
        const comment = (await transaction.collection('comments').doc(commentId).get()).data
        if (!post || !comment) return null
        const parent = comment.depth === 1 && typeof comment.parent_id === 'string'
          ? (await transaction.collection('comments').doc(comment.parent_id).get()).data : null
        if (comment.depth === 1 && !parent) return null
        if (comment.anonymous !== true) {
          if (!accountId) throw Error('Notification actor unavailable')
          const profile = (await transaction.collection('users').doc(accountId).get()).data
          if (!profile || profile._openid !== comment._openid) throw Error('Notification actor unavailable')
          comment.author = { _openid: comment._openid, nickname: profile.nickname,
            avatar_url: profile.avatar_url, profile_version: profile.profile_version }
        }
        return { post, comment, parent }
      },
    })),
  }, notification)
}
