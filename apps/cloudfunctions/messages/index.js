// cloud function: messages - Private messaging and notification reads
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database({ throwOnNotFound: false })
const { ok, fail, stableDocumentId, checkRateLimit, authorizeAction, withAuth } = require('../common')
const { listConversationDirectory, InvalidDirectoryRequest, readMessageHistory, InvalidHistoryRequest, syncMessages, InvalidMessageSyncRequest, markMessagesRead, InvalidReadRequest, readReceipts, InvalidReceiptRequest, sendNewMessage, InvalidSendRequest, MessageIdConflict, resolveConversationTarget, InvalidConversationTarget, ConversationTargetNotFound, listUserNotifications, markUserNotificationsRead, countUserNotifications, InvalidNotificationRequest } = require('@lucky/server')
const { createCloudBaseMessagingAdapters, MessageRecipientUnavailable } = require('@lucky/adapters')

class SendRateRejected extends Error {
  constructor(unavailable) { super('Send rate rejected'); this.unavailable = unavailable }
}

const adapters = createCloudBaseMessagingAdapters(db, {
  identifier: stableDocumentId,
  async authorizeSendRate(owner) {
    const rate = await checkRateLimit(db, owner, 'messages:send', { limit: 120, windowMs: 3600000 })
    if (!rate.allowed) throw new SendRateRejected(rate.unavailable)
  },
})

exports.main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'messages', event.action)
  if (!authorization.allowed) return authorization.response
  switch (event.action) {
    case 'send': return sendMessage(openid, event)
    case 'listConversations': return listConversations(openid, event)
    case 'getUnreadMessageCount': return getUnreadMessageCount(openid)
    case 'getReadReceipts': return getReadReceipts(openid, event)
    case 'getConversation': return getConversation(openid, event)
    case 'syncConversation': return syncConversation(openid, event)
    case 'markRead': return markRead(openid, event)
    case 'listNotifications': return listNotifications(openid, event)
    case 'getUnreadNotificationCount': return getUnreadNotificationCount(openid)
    case 'markNotificationsRead': return markNotificationsRead(openid, event.notificationIds)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})

function conversationIdFor(openid, resolved) {
  if (resolved.anonymousContext) {
    return stableDocumentId('conversation', 'anonymous', resolved.anonymousContext.thread_id)
  }
  return stableDocumentId('conversation', 'direct', ...[openid, resolved.peer].sort())
}

async function resolveConversationPeer(openid, event) {
  try { return await resolveConversationTarget(adapters.targetStore, openid, event) } catch (error) {
    if (error instanceof InvalidConversationTarget) return { error: fail('会话目标无效', 'INVALID_INPUT') }
    if (error instanceof ConversationTargetNotFound) return { error: fail('会话不存在', 'NOT_FOUND') }
    return { error: fail('会话查询失败', 'QUERY_ERROR') }
  }
}

async function sendMessage(openid, event) {
  const resolved = await resolveConversationPeer(openid, event)
  if (resolved.error) return resolved.error
  const conversationId = conversationIdFor(openid, resolved)
  const store = adapters.createSendStore(conversationId, openid, resolved.peer)
  try {
    return ok(await sendNewMessage(store, { id: conversationId, viewer: openid, peer: resolved.peer,
      anonymousThread: resolved.anonymousContext ? resolved.anonymousContext.thread_id : undefined,
    }, resolved.anonymousContext, event))
  } catch (error) {
    if (error instanceof InvalidSendRequest) return fail('消息内容或消息ID无效', 'INVALID_INPUT')
    if (error instanceof MessageIdConflict) return fail('相同消息ID不能用于不同内容', 'CONFLICT')
    if (error instanceof MessageRecipientUnavailable) return fail('收件用户不存在', 'NOT_FOUND')
    if (error instanceof SendRateRejected) return fail(error.unavailable ? '服务繁忙，请稍后重试' : '发送太频繁，请稍后再试', error.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
    console.error('[messages] send failed:', error.message || error)
    return fail('发送失败', 'SEND_ERROR')
  }
}

async function listConversations(openid, event) {
  try {
    const page = await listConversationDirectory(adapters.directoryStore, {
      ownerId: openid, scope: stableDocumentId('conversation-directory', openid),
    }, event)
    return ok({ ...page, source: 'directory' })
  } catch (error) {
    if (error instanceof InvalidDirectoryRequest) return fail('分页参数无效', 'INVALID_INPUT')
    console.error('[messages] conversation list failed:', error.message || error)
    return fail('查询失败', 'QUERY_ERROR')
  }
}
async function getUnreadMessageCount(openid) {
  try {
    return ok({ count: await adapters.unreadMessageCount(openid) })
  } catch (_) {
    return fail('未读数量查询失败', 'QUERY_ERROR')
  }
}

async function getConversation(openid, event) {
  const resolved = await resolveConversationPeer(openid, event)
  if (resolved.error) return resolved.error
  try {
    const page = await readMessageHistory(adapters.historyStore, {
      id: conversationIdFor(openid, resolved), viewer: openid, peer: resolved.peer,
      anonymousThread: resolved.anonymousContext ? resolved.anonymousContext.thread_id : undefined,
    }, event)
    const context = resolved.anonymousContext
    return ok({ ...page, chat_target: context ? { anonymous: true, type: context.source_type, id: context.source_id, thread_id: context.thread_id } : undefined })
  } catch (error) {
    if (error instanceof InvalidHistoryRequest) return fail('分页参数无效', 'INVALID_INPUT')
    console.error('[messages] conversation query failed:', error.message || error)
    return fail('查询失败', 'QUERY_ERROR')
  }
}

async function syncConversation(openid, event) {
  const resolved = await resolveConversationPeer(openid, event)
  if (resolved.error) return resolved.error
  try {
    return ok(await syncMessages(adapters.messageSyncStore, {
      id: conversationIdFor(openid, resolved), viewer: openid, peer: resolved.peer,
      anonymousThread: resolved.anonymousContext ? resolved.anonymousContext.thread_id : undefined,
    }, event))
  } catch (error) {
    if (error instanceof InvalidMessageSyncRequest) return fail('同步参数无效', 'INVALID_INPUT')
    console.error('[messages] sequence sync failed:', error.message || error)
    return fail('同步失败', 'QUERY_ERROR')
  }
}

async function getReadReceipts(openid, event) {
  const resolved = await resolveConversationPeer(openid, event)
  if (resolved.error) return resolved.error
  try {
    const readIds = await readReceipts(adapters.readReceiptStore, { id: conversationIdFor(openid, resolved), viewer: openid, peer: resolved.peer,
      anonymousThread: resolved.anonymousContext ? resolved.anonymousContext.thread_id : undefined,
    }, event.msgIds)
    return ok({ readIds })
  } catch (error) {
    if (error instanceof InvalidReceiptRequest) return fail('回执消息列表无效', 'INVALID_INPUT')
    return fail('回执查询失败', 'QUERY_ERROR')
  }
}

async function markRead(openid, event) {
  const resolved = await resolveConversationPeer(openid, event)
  if (resolved.error) return resolved.error
  const conversationId = conversationIdFor(openid, resolved)
  const store = adapters.createReadStore(conversationId, openid)
  try {
    const updated = await markMessagesRead(store, {
      id: conversationId, viewer: openid, peer: resolved.peer,
      anonymousThread: resolved.anonymousContext ? resolved.anonymousContext.thread_id : undefined,
    }, event.msgIds)
    return ok({ updated })
  } catch (error) {
    if (error instanceof InvalidReadRequest) return fail('已读消息列表无效', 'INVALID_INPUT')
    console.error('[messages] mark read failed:', error.message || error)
    return fail('操作失败', 'UPDATE_ERROR')
  }
}

async function listNotifications(openid, event) {
  try { return ok(await listUserNotifications(adapters.notificationStore, openid, event)) } catch (error) {
    if (error instanceof InvalidNotificationRequest) return fail('通知分页参数无效', 'INVALID_INPUT')
    return fail('查询失败', 'QUERY_ERROR')
  }
}

async function getUnreadNotificationCount(openid) {
  try { return ok({ count: await countUserNotifications(adapters.notificationStore, openid) }) } catch (_) {
    return fail('查询失败', 'QUERY_ERROR')
  }
}

async function markNotificationsRead(openid, notificationIds) {
  try { return ok({ updated: await markUserNotificationsRead(adapters.notificationStore, openid, notificationIds) }) } catch (error) {
    if (error instanceof InvalidNotificationRequest) return fail('通知ID列表无效', 'INVALID_INPUT')
    return fail('操作失败', 'UPDATE_ERROR')
  }
}
