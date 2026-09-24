import { parseConversationTarget } from '@lynku/contracts'
import { AccountRestrictionFailure } from '@lynku/server'
import { findSentMessage, projectConversationDisplay, blockedInConversation } from '@lynku/server'
// cloud function: messages - Private messaging and notification reads
import * as cloud from 'wx-server-sdk'
import { connectDatabase, CLOUD_DATABASE_OPTIONS, type Row } from '../common/database'
import type { CloudEvent } from '../common'
import type { AnonymousConversationContext } from '@lynku/server'
cloud.init()
const db = cloud.database(CLOUD_DATABASE_OPTIONS)
const safeDb = connectDatabase(db)
import { ok, fail, stableDocumentId, checkRateLimit, authorizeAction, withAuth } from '../common'
import { listConversationDirectory, InvalidDirectoryRequest, readMessageHistory, InvalidHistoryRequest, syncMessages, InvalidMessageSyncRequest, markMessagesRead, InvalidReadRequest, readReceipts, InvalidReceiptRequest, sendNewMessage, InvalidSendRequest, MessageIdConflict, resolveConversationTarget, InvalidConversationTarget, ConversationTargetNotFound, listUserNotifications, markUserNotificationsRead, countUserNotifications, InvalidNotificationRequest, ModerationFailure } from '@lynku/server'
import { createCloudBaseMessagingAdapters, MessageRecipientUnavailable, wechatTextSafety } from '@lynku/adapters'

class SendRateRejected extends Error {
  constructor(readonly unavailable: boolean) { super('Send rate rejected') }
}
class ContactBlocked extends Error {}

function blockIdFor(left: string, right: string) {
  return stableDocumentId('messaging:block', ...[left, right].sort())
}
function blockRow(value: Row | null) {
  if (value === null) return { blockedBy: [] as string[], version: 0 }
  if (!Array.isArray(value.blockedBy) || value.blockedBy.some(item => typeof item !== 'string')
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0) throw Error('Invalid block state')
  return { blockedBy: value.blockedBy as string[], version: value.version }
}

function adaptersFor(openid: string) { return createCloudBaseMessagingAdapters(db, {
  identifier: stableDocumentId,
  moderate: wechatTextSafety(input => cloud.openapi.security.msgSecCheck(input), openid, 2),
  async assertCanSend(owner, peer) {
    const current = (await safeDb.collection('messaging_blocks').doc(blockIdFor(owner, peer)).get()).data
    if (blockRow(current).blockedBy.length > 0) throw new ContactBlocked()
  },
  async authorizeSendRate(owner) {
    const rate = await checkRateLimit(db, owner, 'messages:send', { limit: 120, windowMs: 3600000 })
    if (!rate.allowed) throw new SendRateRejected(rate.unavailable === true)
  },
}) }

export const main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'messages', event.action)
  if (!authorization.allowed) return authorization.response
  switch (event.action) {
    case 'send': return sendMessage(openid, event)
    case 'getSendResult': return getSendResult(openid, event)
    case 'listContactBlocks': return listContactBlocks(openid, event)
    case 'listConversations': return listConversations(openid, event)
    case 'getUnreadMessageCount': return getUnreadMessageCount(openid)
    case 'getReadReceipts': return getReadReceipts(openid, event)
    case 'getConversation': return getConversation(openid, event)
    case 'getConversationDisplay': return getConversationDisplay(openid, event)
    case 'syncConversation': return syncConversation(openid, event)
    case 'markRead': return markRead(openid, event)
    case 'listNotifications': return listNotifications(openid, event)
    case 'getUnreadNotificationCount': return getUnreadNotificationCount(openid)
    case 'markNotificationsRead': return markNotificationsRead(openid, event.notificationIds)
    case 'blockContact': return blockContact(openid, event)
    case 'unblockContact': return unblockContact(openid, event)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})

type ResolvedConversation = { peer: string; anonymousContext: AnonymousConversationContext | null }
type ResolveResult = ResolvedConversation | { error: ReturnType<typeof fail> }
function isResolved(value: ResolveResult): value is ResolvedConversation { return !('error' in value) }
function conversationIdFor(openid: string, resolved: ResolvedConversation) {
  if (resolved.anonymousContext) {
    return stableDocumentId('conversation', 'anonymous', resolved.anonymousContext.thread_id)
  }
  return stableDocumentId('conversation', 'direct', ...[openid, resolved.peer].sort())
}
function authorizedConversation(openid: string, resolved: ResolvedConversation) {
  const base = { id: conversationIdFor(openid, resolved), viewer: openid, peer: resolved.peer }
  if (!resolved.anonymousContext) return base
  const context = resolved.anonymousContext
  const peerVisibility = openid === context.initiator_openid ? context.target_visibility : context.initiator_visibility
  return { ...base, anonymousThread: context.thread_id, peerVisibility }
}

async function resolveConversationPeer(openid: string, event: unknown): Promise<ResolveResult> {
  try { return await resolveConversationTarget(adaptersFor(openid).targetStore, openid, event) } catch (error) {
    if (error instanceof InvalidConversationTarget) return { error: fail('会话目标无效', 'INVALID_INPUT') }
    if (error instanceof ConversationTargetNotFound) return { error: fail('会话不存在', 'NOT_FOUND') }
    return { error: fail('会话查询失败', 'QUERY_ERROR') }
  }
}

async function sendMessage(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  const conversationId = conversationIdFor(openid, resolved)
  const store = adaptersFor(openid).createSendStore(conversationId, openid, resolved.peer, resolved.anonymousContext)
  try {
    return ok(await sendNewMessage(store, authorizedConversation(openid, resolved), resolved.anonymousContext, event))
  } catch (error) {
    if (error instanceof AccountRestrictionFailure) return fail(error.message, error.code)
    if (error instanceof InvalidSendRequest) return fail('消息内容或消息ID无效', 'INVALID_INPUT')
    if (error instanceof ModerationFailure) return fail(error.code === 'CONTENT_REJECTED' ? '内容未通过审核，请修改后提交' : '审核服务暂不可用，请稍后重试', error.code)
    if (error instanceof MessageIdConflict) return fail('相同消息ID不能用于不同内容', 'CONFLICT')
    if (error instanceof MessageRecipientUnavailable) return fail('收件用户不存在', 'NOT_FOUND')
    if (error instanceof ContactBlocked) return fail('当前无法发送给该用户', 'FORBIDDEN')
    if (error instanceof SendRateRejected) return fail(error.unavailable ? '服务繁忙，请稍后重试' : '发送太频繁，请稍后再试', error.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
    console.error('[messages] send failed:', error instanceof Error ? error.message : error)
    return fail('发送失败', 'SEND_ERROR')
  }
}

async function getSendResult(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  try {
    const result = await findSentMessage(adaptersFor(openid).createSendStore(conversationIdFor(openid, resolved), openid, resolved.peer),
      authorizedConversation(openid, resolved), resolved.anonymousContext, event)
    return ok({ result })
  } catch (error) {
    if (error instanceof InvalidSendRequest) return fail('消息参数无效', 'INVALID_INPUT')
    if (error instanceof MessageIdConflict) return fail('消息请求不一致', 'CONFLICT')
    return fail('暂时无法确认发送结果', 'QUERY_ERROR')
  }
}

async function listConversations(openid: string, event: unknown) {
  try {
    const page = await listConversationDirectory(adaptersFor(openid).directoryStore, {
      ownerId: openid, scope: stableDocumentId('conversation-directory', openid),
    }, event)
    return ok({ ...page, source: 'directory' })
  } catch (error) {
    if (error instanceof InvalidDirectoryRequest) return fail('分页参数无效', 'INVALID_INPUT')
    console.error('[messages] conversation list failed:', error instanceof Error ? error.message : error)
    return fail('查询失败', 'QUERY_ERROR')
  }
}
async function getUnreadMessageCount(openid: string) {
  try {
    return ok({ count: await adaptersFor(openid).unreadMessageCount(openid) })
  } catch (_) {
    return fail('未读数量查询失败', 'QUERY_ERROR')
  }
}

async function getConversation(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  try {
    const page = await readMessageHistory(adaptersFor(openid).historyStore, authorizedConversation(openid, resolved), event)
    const target = parseConversationTarget(event)
    const display = await conversationDisplay(openid, resolved)
    return ok({ ...page, display, chat_target: 'target' in target ? target.target : undefined })
  } catch (error) {
    if (error instanceof InvalidHistoryRequest) return fail('分页参数无效', 'INVALID_INPUT')
    console.error('[messages] conversation query failed:', error instanceof Error ? error.message : error)
    return fail('查询失败', 'QUERY_ERROR')
  }
}

async function conversationDisplay(openid: string, resolved: ResolvedConversation) {
  const context = resolved.anonymousContext
  const peerVisibility = context ? openid === context.initiator_openid ? context.target_visibility : context.initiator_visibility : 'real'
  const profiles = peerVisibility === 'real' ? await adaptersFor(openid).directoryStore.profiles([resolved.peer]) : []
  const block = (await safeDb.collection('messaging_blocks').doc(blockIdFor(openid, resolved.peer)).get()).data
  return projectConversationDisplay(openid, context, profiles[0], blockedInConversation(block, openid, conversationIdFor(openid, resolved)))
}

async function getConversationDisplay(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  try { return ok(await conversationDisplay(openid, resolved)) } catch (_) { return fail('会话身份暂不可用', 'QUERY_ERROR') }
}

async function syncConversation(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  try {
    return ok(await syncMessages(adaptersFor(openid).messageSyncStore, authorizedConversation(openid, resolved), event))
  } catch (error) {
    if (error instanceof InvalidMessageSyncRequest) return fail('同步参数无效', 'INVALID_INPUT')
    console.error('[messages] sequence sync failed:', error instanceof Error ? error.message : error)
    return fail('同步失败', 'QUERY_ERROR')
  }
}

async function getReadReceipts(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  try {
    const readIds = await readReceipts(adaptersFor(openid).readReceiptStore, authorizedConversation(openid, resolved), event.msgIds)
    return ok({ readIds })
  } catch (error) {
    if (error instanceof InvalidReceiptRequest) return fail('回执消息列表无效', 'INVALID_INPUT')
    return fail('回执查询失败', 'QUERY_ERROR')
  }
}

async function markRead(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  const conversationId = conversationIdFor(openid, resolved)
  const store = adaptersFor(openid).createReadStore(conversationId, openid)
  try {
    const updated = await markMessagesRead(store, authorizedConversation(openid, resolved), event.msgIds)
    return ok({ updated })
  } catch (error) {
    if (error instanceof InvalidReadRequest) return fail('已读消息列表无效', 'INVALID_INPUT')
    console.error('[messages] mark read failed:', error instanceof Error ? error.message : error)
    return fail('操作失败', 'UPDATE_ERROR')
  }
}

async function listNotifications(openid: string, event: unknown) {
  try { return ok(await listUserNotifications(adaptersFor(openid).notificationStore, openid, event)) } catch (error) {
    if (error instanceof InvalidNotificationRequest) return fail('通知分页参数无效', 'INVALID_INPUT')
    return fail('查询失败', 'QUERY_ERROR')
  }
}

async function getUnreadNotificationCount(openid: string) {
  try { return ok({ count: await countUserNotifications(adaptersFor(openid).notificationStore, openid) }) } catch (_) {
    return fail('查询失败', 'QUERY_ERROR')
  }
}

async function markNotificationsRead(openid: string, notificationIds: unknown) {
  try { return ok({ updated: await markUserNotificationsRead(adaptersFor(openid).notificationStore, openid, notificationIds) }) } catch (error) {
    if (error instanceof InvalidNotificationRequest) return fail('通知ID列表无效', 'INVALID_INPUT')
    return fail('操作失败', 'UPDATE_ERROR')
  }
}

async function blockContact(openid: string, event: CloudEvent) {
  const resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  const id = blockIdFor(openid, resolved.peer)
  const conversation = conversationIdFor(openid, resolved)
  const operationId = stableDocumentId('block-operation', openid, conversation)
  try {
    const context = resolved.anonymousContext
    const peerAnonymous = context && (context.initiator_openid === openid ? context.target_visibility : context.initiator_visibility) === 'anonymous'
    const profiles = peerAnonymous ? [] : await adaptersFor(openid).directoryStore.profiles([resolved.peer])
    const label = projectConversationDisplay(openid, context, profiles[0], true).peerName
    await safeDb.runTransaction(async transaction => {
      const reference = transaction.collection('messaging_blocks').doc(id)
      const row = (await reference.get()).data
      const state = blockRow(row)
      const operations: Row = row?.operations && typeof row.operations === 'object' && !Array.isArray(row.operations) ? { ...row.operations as Row } : {}
      const own = Array.isArray(operations[openid]) ? operations[openid] as unknown[] : []
      operations[openid] = [...new Set([...own, conversation])]
      if ((operations[openid] as unknown[]).length > 100) throw Error('Too many block operations')
      const operation = transaction.collection('messaging_block_operations').doc(operationId)
      const previous = (await operation.get()).data
      const blockedBy = [...new Set([...state.blockedBy, openid])]
      await reference.set({ data: { blockedBy, operations, version: state.version + 1,
        updatedAt: new Date(), tombstone: false } })
      await operation.set({ data: { owner: openid, peer: resolved.peer, blockId: id, conversation, label,
        active: true, createdAt: previous?.createdAt || new Date() } })
    })
    return ok({ blocked: true })
  } catch (error) {
    console.error('[messages] block failed:', error instanceof Error ? error.message : error)
    return fail('屏蔽未完成，请稍后重试', 'UPDATE_ERROR')
  }
}

async function unblockContact(openid: string, event: CloudEvent) {
  let resolved: ResolveResult
  let requestedOperation: Row | null = null
  if (event.operation_id !== undefined) {
    if (typeof event.operation_id !== 'string' || !/^[a-f0-9]{64}$/.test(event.operation_id)) return fail('屏蔽记录无效', 'INVALID_INPUT')
    try { requestedOperation = (await safeDb.collection('messaging_block_operations').doc(event.operation_id).get()).data } catch (_) { return fail('查询失败', 'QUERY_ERROR') }
    if (!requestedOperation || requestedOperation.owner !== openid || typeof requestedOperation.blockId !== 'string' || !/^[a-f0-9]{64}$/.test(requestedOperation.blockId)
      || typeof requestedOperation.conversation !== 'string') return fail('屏蔽记录不存在', 'NOT_FOUND')
    resolved = { peer: '', anonymousContext: null }
  } else resolved = await resolveConversationPeer(openid, event)
  if (!isResolved(resolved)) return resolved.error
  const id = requestedOperation ? String(requestedOperation.blockId) : blockIdFor(openid, resolved.peer)
  const conversation = requestedOperation ? String(requestedOperation.conversation) : conversationIdFor(openid, resolved)
  const operationId = stableDocumentId('block-operation', openid, conversation)
  if (event.operation_id !== undefined && event.operation_id !== operationId) return fail('屏蔽记录无效', 'INVALID_INPUT')
  try {
    await safeDb.runTransaction(async transaction => {
      const reference = transaction.collection('messaging_blocks').doc(id)
      const row = (await reference.get()).data
      const state = blockRow(row)
      const operations: Row = row?.operations && typeof row.operations === 'object' && !Array.isArray(row.operations) ? { ...row.operations as Row } : {}
      const own = operations[openid]
      const operation = transaction.collection('messaging_block_operations').doc(operationId)
      const record = (await operation.get()).data
      if (!record || record.owner !== openid || record.conversation !== conversation || record.blockId !== id) throw new ContactBlocked()
      if (record.active === false) return
      if (!Array.isArray(own) || !own.includes(conversation)) throw new ContactBlocked()
      const remaining = own.filter(item => item !== conversation)
      if (remaining.length) operations[openid] = remaining
      else delete operations[openid]
      const blockedBy = remaining.length ? state.blockedBy : state.blockedBy.filter(owner => owner !== openid)
      await reference.set({ data: { blockedBy, operations, version: state.version + 1,
        updatedAt: new Date(), tombstone: blockedBy.length === 0 } })
      await operation.update({ data: { active: false } })
    })
    return ok({ blocked: false })
  } catch (error) {
    console.error('[messages] unblock failed:', error instanceof Error ? error.message : error)
    return fail('解除屏蔽未完成，请稍后重试', 'UPDATE_ERROR')
  }
}

async function listContactBlocks(openid: string, event: CloudEvent) {
  if (event.cursor !== undefined && (typeof event.cursor !== 'string' || !/^[a-f0-9]{64}$/.test(event.cursor))) return fail('分页参数无效', 'INVALID_INPUT')
  try {
    const condition: Row = { owner: openid, active: true }
    if (typeof event.cursor === 'string') condition._id = safeDb.command.lt(event.cursor)
    const rows = (await safeDb.collection('messaging_block_operations').where(condition).orderBy('_id', 'desc').limit(21).get()).data
    const items = rows.slice(0, 20).map(row => {
      if (row.owner !== openid || typeof row._id !== 'string' || typeof row.label !== 'string') throw Error('Invalid block record')
      return { id: row._id, label: row.label }
    })
    return ok({ items, nextCursor: rows.length > 20 ? items[items.length - 1]!.id : null })
  } catch (_) { return fail('屏蔽记录暂时无法读取', 'QUERY_ERROR') }
}
