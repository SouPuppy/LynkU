// cloud function: comments — Comment reads, writes, nesting, and notifications
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database({ throwOnNotFound: false })
const _ = db.command
const {
  ok,
  fail,
  validateInput,
  filterSensitiveWords,
  stableDocumentId,
  nextNonnegativeCount,
  claimOutboxEvent,
  outboxCandidates,
  finishOutboxEvent,
  checkAdmin,
  authorizeAction,
  authorSnapshot,
  checkRateLimit,
  withAuth,
  withScheduledDrain,
} = require('../common')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const { projectComment } = require('@lucky/server')

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
exports.main = withScheduledDrain(cloud, authenticated, 'notification-outbox', () => drainNotificationOutbox())

function sanitizeComment(comment, viewerOpenid) {
  return projectComment(comment, viewerOpenid)
}

function parseChangeCursor(postId, cursor) {
  if (!cursor || cursor.version !== 1 || cursor.post_id !== postId || !Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0) {
    return null
  }
  return cursor
}

async function syncCommentChanges(openid, event) {
  const idValidation = validateInput(event.post_id, { maxLen: 128 })
  if (!idValidation.valid) return fail('缺少帖子ID', 'INVALID_INPUT')
  const cursor = parseChangeCursor(idValidation.value, event.cursor)
  if (!cursor) return fail('评论游标无效', 'INVALID_INPUT')
  const limit = Number.isInteger(event.limit) && event.limit > 0 ? Math.min(event.limit, MAX_LIMIT) : DEFAULT_LIMIT
  try {
    const post = await db.collection('posts').doc(idValidation.value).get()
    if (!post.data || post.data.status !== 'published') return fail('帖子不存在', 'POST_NOT_FOUND')
    const page = await db.collection('comment_changes')
      .where({ post_id: idValidation.value, sequence: _.gt(cursor.sequence) })
      .orderBy('sequence', 'asc')
      .limit(limit)
      .get()
    const changes = await Promise.all(page.data.map(async change => {
      const result = await db.collection('comments').doc(change.comment_id).get()
      const comment = result.data ? sanitizeComment(result.data, openid) : null
      return { comment_id: change.comment_id, sequence: change.sequence, type: change.type, comment }
    }))
    const lastSequence = changes.length ? changes[changes.length - 1].sequence : cursor.sequence
    return ok({
      changes,
      next_cursor: { version: 1, post_id: idValidation.value, sequence: lastSequence },
      has_more: page.data.length === limit,
    })
  } catch (error) {
    console.error('[comments] sync changes failed:', error.message || error)
    return fail('评论同步失败', 'QUERY_ERROR')
  }
}

async function listComments(openid, event) {
  const idValidation = validateInput(event.post_id, { maxLen: 128 })
  if (!idValidation.valid) return fail('缺少帖子ID', 'INVALID_INPUT')
  const offset = Number.isInteger(event.offset) && event.offset >= 0 ? event.offset : 0
  const limit = Number.isInteger(event.limit) && event.limit > 0
    ? Math.min(event.limit, MAX_LIMIT)
    : DEFAULT_LIMIT

  try {
    const post = await db.collection('posts').doc(idValidation.value).get()
    if (!post.data || post.data.status !== 'published') return fail('帖子不存在', 'POST_NOT_FOUND')
    const conditions = {
      post_id: idValidation.value,
      status: _.in(['published', 'deleted']),
    }
    const collection = db.collection('comments')
    const [page, count] = await Promise.all([
      collection.where(conditions).orderBy('created_at', 'asc').orderBy('_id', 'asc').skip(offset).limit(limit).get(),
      collection.where(conditions).count(),
    ])
    return ok({
      comments: page.data.map(comment => sanitizeComment(comment, openid)),
      total: count.total,
      hasMore: offset + page.data.length < count.total,
    })
  } catch (error) {
    console.error('[comments] list failed:', error.message || error)
    return fail('评论加载失败', 'QUERY_ERROR')
  }
}

async function createComment(openid, event, principal) {
  const postValidation = validateInput(event.post_id, { maxLen: 128 })
  if (!postValidation.valid) return fail('缺少帖子ID', 'INVALID_INPUT')
  const contentValidation = validateInput(event.content, { minLen: 1, maxLen: 2000 })
  if (!contentValidation.valid) return fail(contentValidation.error, 'INVALID_INPUT')
  const requestId = event.request_id === undefined
    ? null
    : validateInput(event.request_id, { minLen: 8, maxLen: 128 })
  if (requestId && !requestId.valid) return fail('请求ID无效', 'INVALID_INPUT')

  let post
  try {
    const result = await db.collection('posts').doc(postValidation.value).get()
    post = result.data
    if (!post || post.status !== 'published') return fail('帖子不存在', 'POST_NOT_FOUND')
  } catch (_) {
    return fail('帖子不存在', 'POST_NOT_FOUND')
  }

  let depth = 0
  let parentComment = null
  if (event.parent_id) {
    const parentValidation = validateInput(event.parent_id, { maxLen: 128 })
    if (!parentValidation.valid) return fail('父评论不存在', 'NOT_FOUND')
    let parent
    try {
      parent = await db.collection('comments').doc(parentValidation.value).get()
    } catch (_) {
      return fail('父评论不存在', 'NOT_FOUND')
    }
    if (!parent.data || parent.data.status !== 'published') return fail('父评论不存在', 'NOT_FOUND')
    if (parent.data.depth >= 1) return fail('回复已达最大深度', 'MAX_DEPTH')
    if (parent.data.post_id !== postValidation.value) return fail('评论与帖子不匹配', 'PARENT_MISMATCH')
    depth = 1
    parentComment = parent.data
  }

  const retryFingerprint = requestId
    ? stableDocumentId('comment:payload', postValidation.value, parentComment ? parentComment._id : '', contentValidation.value, String(!!event.anonymous))
    : ''
  if (requestId) {
    const documentId = stableDocumentId('comment:create', openid, requestId.value)
    try {
      const existing = await db.collection('comments').doc(documentId).get()
      if (existing.data) {
        if (existing.data.request_fingerprint !== retryFingerprint) {
          return fail('相同请求ID不能用于不同内容', 'CONFLICT')
        }
        return ok({ comment: sanitizeComment(existing.data, openid), flagged: existing.data.status === 'flagged', status: 'duplicate' })
      }
    } catch (_) { /* no successful prior request */ }
  }

  const rate = await checkRateLimit(db, openid, 'comments:create', { limit: 60, windowMs: 3600000 })
  if (!rate.allowed) {
    return fail(rate.unavailable ? '服务繁忙，请稍后重试' : '评论太频繁，请稍后再试', rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
  }

  const content = contentValidation.value
  const filter = filterSensitiveWords(content)
  const status = filter.clean ? 'published' : 'flagged'
  const anonymous = !!event.anonymous
  const author = anonymous
    ? { _openid: openid, nickname: ANONYMOUS_NAME, avatar_url: ANONYMOUS_AVATAR }
    : authorSnapshot(principal, openid)
  const comment = {
    _openid: openid,
    post_id: postValidation.value,
    parent_id: parentComment ? parentComment._id : null,
    depth,
    content,
    author,
    anonymous,
    status,
    created_at: db.serverDate(),
  }
  const requestFingerprint = requestId
    ? stableDocumentId('comment:payload', postValidation.value, parentComment ? parentComment._id : '', content, String(anonymous))
    : ''
  if (requestId) {
    comment.request_id = requestId.value
    comment.request_fingerprint = requestFingerprint
  }

  try {
    const created = await db.runTransaction(async transaction => {
      const currentPost = await transaction.collection('posts').doc(post._id).get()
      if (!currentPost.data || currentPost.data.status !== 'published') {
        throw new Error('Post is no longer published')
      }
      if (parentComment) {
        const currentParent = await transaction.collection('comments').doc(parentComment._id).get()
        if (!currentParent.data || currentParent.data.status !== 'published') {
          throw new Error('Parent comment is no longer published')
        }
      }
      const comments = transaction.collection('comments')
      const documentId = requestId ? stableDocumentId('comment:create', openid, requestId.value) : ''
      let commentId = documentId
      if (documentId) {
        const ref = comments.doc(documentId)
        try {
          const existing = await ref.get()
          if (existing.data) return {
            commentId: documentId,
            duplicate: true,
            conflict: existing.data.request_fingerprint !== requestFingerprint,
          }
        } catch (_) { /* create the deterministic document below */ }
        await ref.set({ data: comment })
      } else {
        const added = await comments.add({ data: comment })
        commentId = added._id
      }
      const savedComment = { ...comment, _id: commentId }
      if (status === 'published') {
        await adjustCommentCount(transaction, post._id, 1)
        await recordCommentChange(transaction, post._id, commentId, 'created')
        return {
          commentId,
          duplicate: false,
          outboxIds: await enqueueCommentNotifications(transaction, savedComment, post, parentComment),
        }
      }
      return { commentId, duplicate: false, outboxIds: [] }
    })
    if (created.conflict) return fail('相同请求ID不能用于不同内容', 'CONFLICT')
    const createdResult = await db.collection('comments').doc(created.commentId).get()

    if (!created.duplicate) await drainNotificationOutbox(created.outboxIds)

    return ok({ comment: sanitizeComment(createdResult.data, openid), flagged: !filter.clean, status: created.duplicate ? 'duplicate' : 'created' })
  } catch (error) {
    console.error('[comments] create failed:', error.message || error)
    return fail('评论失败', 'CREATE_ERROR')
  }
}

async function deleteComment(openid, commentId) {
  const idValidation = validateInput(commentId, { maxLen: 128 })
  if (!idValidation.valid) return fail('缺少评论ID', 'INVALID_INPUT')

  try {
    const result = await db.collection('comments').doc(idValidation.value).get()
    const comment = result.data
    if (!comment) return fail('评论不存在', 'NOT_FOUND')
    if (comment._openid !== openid && !(await checkAdmin(db, openid))) {
      return fail('无权操作', 'FORBIDDEN')
    }
    if (comment.status === 'deleted') return ok({ deleted: true })

    await db.runTransaction(async transaction => {
      const commentRef = transaction.collection('comments').doc(comment._id)
      const currentResult = await commentRef.get()
      const current = currentResult.data
      if (!current || current.status === 'deleted') return
      await commentRef.update({
        data: { status: 'deleted', content: '', updated_at: db.serverDate() },
      })
      if (current.status === 'published') {
        await adjustCommentCount(transaction, current.post_id, -1)
        await recordCommentChange(transaction, current.post_id, current._id, 'deleted')
      }
    })
    return ok({ deleted: true })
  } catch (error) {
    console.error('[comments] delete failed:', error.message || error)
    return fail('删除失败', 'DELETE_ERROR')
  }
}

async function adjustCommentCount(transaction, postId, delta) {
  const ref = transaction.collection('posts').doc(postId)
  const result = await ref.get()
  if (!result.data) throw new Error(`Post not found: ${postId}`)
  const next = nextNonnegativeCount(result.data.comment_count, delta)
  await ref.update({ data: { comment_count: next, updated_at: db.serverDate() } })
}

async function recordCommentChange(transaction, postId, commentId, type) {
  const counter = transaction.collection('comment_counters').doc(postId)
  let current = null
  try {
    current = (await counter.get()).data || null
  } catch (_) { /* create the counter in this transaction */ }
  const sequence = Number(current && current.sequence || 0) + 1
  await counter.set({ data: { post_id: postId, sequence, updated_at: db.serverDate() } })
  await transaction.collection('comment_changes').doc(stableDocumentId('comment:change', postId, String(sequence))).set({
    data: { post_id: postId, sequence, comment_id: commentId, type, created_at: db.serverDate() },
  })
}

function notificationPayload(type, to, comment, post) {
  return {
    type,
    to,
    actor: comment.author,
    anonymous: !!comment.anonymous,
    target: {
      post_id: post._id,
      comment_id: comment._id,
      post_title: post.title,
      comment_preview: comment.content.substring(0, 100),
    },
  }
}

async function enqueueCommentNotifications(transaction, comment, post, parentComment) {
  const notifications = []
  if (comment.depth === 0 && post._openid !== comment._openid) {
    notifications.push(notificationPayload('comment', post._openid, comment, post))
  } else if (comment.depth === 1 && parentComment) {
    if (parentComment._openid !== comment._openid) notifications.push(notificationPayload('reply', parentComment._openid, comment, post))
    if (post._openid !== comment._openid && post._openid !== parentComment._openid) notifications.push(notificationPayload('comment', post._openid, comment, post))
  }
  const ids = []
  for (const notification of notifications) {
    const id = stableDocumentId('notification:outbox', notification.type, notification.to, comment._id)
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

async function drainNotificationOutbox(ids) {
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

async function createNotification(notification) {
  const notificationId = stableDocumentId(
    'notification',
    notification.type,
    notification.to,
    notification.actor._openid || '',
    notification.target && notification.target.comment_id || '',
  )

  const data = {
    ...notification,
    read: false,
    created_at: db.serverDate(),
  }
  return db.runTransaction(async transaction => {
    const ref = transaction.collection('notifications').doc(notificationId)
    const duplicate = await ref.get()
    if (duplicate.data) return duplicate.data
    await ref.set({ data })
    return { ...data, _id: notificationId }
  })
}
