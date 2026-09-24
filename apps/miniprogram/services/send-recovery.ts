import { SendOperations, parseStoredSendOperations, type SendOperation } from '../features/messaging/send-operations'
import type { IMessage, IAnonymousChatTarget } from '../typings/cloudbase'
import * as session from './session'
import { sendMessage, getSendResult } from './messages'
import { parseAnonymousChatTarget } from '../generated/contracts/index'

export interface PendingConversation { id: string; name: string; peer: string; target: IAnonymousChatTarget | null; preview: string; at: number }
const indexKey = (owner: string) => `message_pending_threads_v1:${encodeURIComponent(owner)}`
export function listPendingConversations(): PendingConversation[] {
  const owner = session.getOpenid()
  if (!owner || session.getState() !== 'verified') return []
  const saved: unknown = wx.getStorageSync(indexKey(owner))
  if (saved === undefined || saved === null || saved === '') return []
  if (!Array.isArray(saved) || saved.length > 50) throw Error('待确认会话无法读取')
  return saved.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw Error('待确认会话无法读取')
    const item = value as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || item.id.length > 128 || typeof item.name !== 'string' || item.name.length > 128
      || typeof item.peer !== 'string' || item.peer.length > 128 || typeof item.preview !== 'string' || item.preview.length > 100
      || typeof item.at !== 'number' || !Number.isFinite(item.at)) throw Error('待确认会话无法读取')
    const target = item.target === null ? null : parseAnonymousChatTarget(item.target)
    if ((!item.peer && !target) || (item.peer && target)) throw Error('待确认会话目标无效')
    return { id: item.id, name: item.name, peer: item.peer, target, preview: item.preview, at: item.at }
  }).filter(item => {
    const pending: unknown = wx.getStorageSync(`message_send_v1:${encodeURIComponent(owner)}:${item.id}`)
    return Array.isArray(pending) && pending.length > 0
  }).sort((a, b) => b.at - a.at)
}

export function createSendRecovery(conversation: string, peer: string | undefined, target: IAnonymousChatTarget | null,
  visible: () => boolean, changed: (operations: SendOperation[]) => void, confirmed: (message: IMessage) => void,
  displayName = '聊天', storageFailed: () => void = () => {}): SendOperations<IMessage> {
  const owner = session.getOpenid(), revision = session.getRevision()
  const key = `message_send_v1:${encodeURIComponent(owner || '')}:${conversation}`
  const stored: unknown = wx.getStorageSync(key)
  const existing = listPendingConversations().find(item => item.id === conversation)
  const restoredAt = existing && Number.isSafeInteger(existing.at) && existing.at >= 0
    && Number.isFinite(new Date(existing.at).getTime()) ? existing.at : Date.now()
  const restored = parseStoredSendOperations(stored, restoredAt)
  const ownsSession = () => session.getRevision() === revision && session.getOpenid() === owner && session.getState() === 'verified'
  const save = (operations: SendOperation[]): void => {
    if (!ownsSession()) throw Error('会话已变更，请重新进入聊天')
    const entries = listPendingConversations()
    const previous = entries.find(item => item.id === conversation)
    const others = entries.filter(item => item.id !== conversation)
    const directoryKey = indexKey(owner || '')
    if (operations.length) {
      if (others.length >= 50) throw Error('请先处理待确认会话')
      const last = operations[operations.length - 1]!
      const entry: PendingConversation = { id: conversation, name: displayName, peer: peer || '', target,
        preview: last.text.slice(0, 100), at: previous?.at ?? last.submittedAt }
      // Index first: if it fails, a new submission has not been persisted or transmitted.
      // An interrupted record write can leave only a harmless empty index entry (filtered on read), never an undiscoverable send.
      wx.setStorageSync(directoryKey, [...others, entry])
      try { wx.setStorageSync(key, operations) } catch (error) {
        try {
          if (entries.length) wx.setStorageSync(directoryKey, entries)
          else wx.removeStorageSync(directoryKey)
        } catch (_) { storageFailed() }
        throw error
      }
    } else {
      // The durable operation is authoritative. Stale directory entries are filtered and can be cleaned on the next save.
      wx.removeStorageSync(key)
      try {
        if (others.length) wx.setStorageSync(directoryKey, others)
        else wx.removeStorageSync(directoryKey)
      } catch (_) { storageFailed() }
    }
  }
  const controller = new SendOperations<IMessage>({
    now: Date.now,
    valid: () => visible() && ownsSession(),
    send: async (msgId, content) => (await sendMessage({ to: peer, target, msgId, content })).message,
    lookup: (msgId, content) => getSendResult({ to: peer, target, msgId, content }),
    save, changed, confirmed, storageFailed,
  }, restored)
  // Upgrade v1 records in place so timestamps and known rejection intent survive another restart.
  if (restored.length && visible() && ownsSession()) {
    try { save(controller.snapshot()) } catch (_) { storageFailed() }
  }
  return controller
}
