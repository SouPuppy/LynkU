// services/messages.ts — Private messaging data access
// All access via cloud functions (messages collection is admin-only)

import type { IMessage, IAnonymousChatTarget, IMessageSyncCursor } from '../typings/cloudbase'
import { callCloud, CloudCallError } from './cloud'
import { getRevision } from './session'
import { READ_BATCH_SIZE, parseReadMessageIds, parseReadResult, parseReadReceipts } from '../generated/contracts/index'
import { parseSendMessageResponse } from '../generated/contracts/index'
import { parseConversationDirectoryPage, parseMessageHistoryPage, parseMessageSyncPage } from '../generated/contracts/index'
import type { ConversationDirectoryCursor, ConversationDirectoryPage } from '../generated/contracts/index'
import { parseContactBlockPage, parseConversationDisplay } from '../generated/contracts/index'
export type { ConversationDirectoryCursor } from '../generated/contracts/index'

export async function getConversationDisplay(peer: string | undefined, target: IAnonymousChatTarget | null) {
  return parseConversationDisplay(await callCloud<unknown>('messages', { action: 'getConversationDisplay', peer, anonymous_target: target || undefined }))
}

export async function listContactBlocks(cursor?: string) {
  return parseContactBlockPage(await callCloud<unknown>('messages', { action: 'listContactBlocks', cursor }))
}
export async function unblockContactOperation(id: string): Promise<void> {
  const response = await callCloud<unknown>('messages', { action: 'unblockContact', operation_id: id })
  if (!response || typeof response !== 'object' || !('blocked' in response) || response.blocked !== false) throw Error('解除屏蔽未能确认')
}

function anonymousTargetPayload(target?: IAnonymousChatTarget | null) {
  return target || undefined
}

export async function getSendResult(data: { to?: string; target?: IAnonymousChatTarget | null; content: string; msgId: string }): Promise<IMessage | null> {
  const response = await callCloud<unknown>('messages', { action: 'getSendResult', to: data.to,
    anonymous_target: anonymousTargetPayload(data.target), content: data.content, msg_id: data.msgId })
  if (!response || typeof response !== 'object' || !('result' in response)) throw new Error('无法确认发送结果')
  return response.result === null ? null : parseSendMessageResponse(response.result).message
}

export async function setContactBlocked(peer: string | undefined, target: IAnonymousChatTarget | null | undefined, blocked: boolean): Promise<void> {
  const result = await callCloud<unknown>('messages', { action: blocked ? 'blockContact' : 'unblockContact',
    peer, anonymous_target: anonymousTargetPayload(target) })
  if (!result || typeof result !== 'object' || !('blocked' in result) || result.blocked !== blocked) {
    throw new CloudCallError('屏蔽状态未能确认，请稍后重试', 'INVALID_RESPONSE', 'messages', blocked ? 'blockContact' : 'unblockContact')
  }
}

/** Send a message (idempotent via msgId) */
export async function sendMessage(data: {
  to?: string
  target?: IAnonymousChatTarget | null
  content: string
  msgId: string
}): Promise<{ message: IMessage; status: string }> {
  const response = await callCloud<unknown>('messages', {
    action: 'send',
    to: data.to,
    anonymous_target: anonymousTargetPayload(data.target),
    content: data.content,
    msg_id: data.msgId,
  })
  try { return parseSendMessageResponse(response) } catch (_) {
    throw new CloudCallError('消息发送返回了无效数据', 'INVALID_RESPONSE', 'messages', 'send')
  }
}

/** Count unread messages across every conversation without fetching history. */
export async function getUnreadMessageCount(): Promise<number> {
  const result = await callCloud<{ count: number }>('messages', { action: 'getUnreadMessageCount' })
  return result.count
}

/** Exclusive activity-time/id cursor; refresh restarts the live directory. */
export async function listConversations(cursor?: ConversationDirectoryCursor): Promise<ConversationDirectoryPage> {
  const response = await callCloud<unknown>('messages', {
    action: 'listConversations',
    cursor,
    limit: 20,
  })
  try { return parseConversationDirectoryPage(response) } catch (_) {
    throw new CloudCallError('会话列表返回了无效数据', 'INVALID_RESPONSE', 'messages', 'listConversations')
  }
}

/** Get paginated conversation history with a peer */
export async function getConversation(
  peerOpenid?: string,
  before?: IMessageSyncCursor,
  limit = 30,
  target?: IAnonymousChatTarget | null,
) {
  const response = await callCloud<unknown>('messages', {
    action: 'getConversation',
    peer: peerOpenid,
    anonymous_target: anonymousTargetPayload(target),
    before,
    limit,
  })
  try { return parseMessageHistoryPage(response) } catch (_) {
    throw new CloudCallError('聊天记录返回了无效数据', 'INVALID_RESPONSE', 'messages', 'getConversation')
  }
}

/** Synchronize messages after an exclusive, server-assigned conversation sequence. */
export async function syncConversation(
  peerOpenid: string | undefined,
  cursor: IMessageSyncCursor,
  limit = 50,
  target?: IAnonymousChatTarget | null,
): Promise<{ messages: IMessage[]; hasMore: boolean; nextCursor: IMessageSyncCursor }> {
  const response = await callCloud<unknown>('messages', {
    action: 'syncConversation',
    peer: peerOpenid,
    anonymous_target: anonymousTargetPayload(target),
    cursor,
    limit,
  })
  try { return parseMessageSyncPage(response, cursor) } catch (_) {
    throw new CloudCallError('消息同步返回了无效数据', 'INVALID_RESPONSE', 'messages', 'syncConversation')
  }
}

export async function getReadReceipts(peer: string | undefined, msgIds: string[], target?: IAnonymousChatTarget | null): Promise<string[]> {
  const ids = parseReadMessageIds(msgIds)
  const response = await callCloud<unknown>('messages', {
    action: 'getReadReceipts', peer, msgIds: ids, anonymous_target: anonymousTargetPayload(target),
  })
  try { return parseReadReceipts(response, ids) } catch (_) {
    throw new CloudCallError('已读回执返回了无效数据', 'INVALID_RESPONSE', 'messages', 'getReadReceipts')
  }
}

/** Mark messages from a peer as read */
export async function markRead(
  peerOpenid: string | undefined,
  msgIds: string[],
  target?: IAnonymousChatTarget | null,
): Promise<number> {
  const revision = getRevision()
  const ids = [...new Set(msgIds)]
  let updated = 0
  for (let offset = 0; offset < ids.length; offset += READ_BATCH_SIZE) {
    if (getRevision() !== revision) throw new Error('会话已变更，请重新操作')
    const batch = parseReadMessageIds(ids.slice(offset, offset + READ_BATCH_SIZE))
    const response = await callCloud<unknown>('messages', {
      action: 'markRead', peer: peerOpenid,
      anonymous_target: anonymousTargetPayload(target), msgIds: batch,
    })
    if (getRevision() !== revision) throw new Error('会话已变更，请重新操作')
    try { updated += parseReadResult(response, batch.length) } catch (_) {
      throw new CloudCallError('已读操作返回了无效数据', 'INVALID_RESPONSE', 'messages', 'markRead')
    }
  }
  return updated
}
