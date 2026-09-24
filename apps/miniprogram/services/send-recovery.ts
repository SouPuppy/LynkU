import { SendOperations, type SendOperation } from '../features/messaging/send-operations'
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
  displayName = '聊天'): SendOperations<IMessage> {
  const owner = session.getOpenid(), revision = session.getRevision()
  const key = `message_send_v1:${encodeURIComponent(owner || '')}:${conversation}`
  const stored: unknown = wx.getStorageSync(key)
  let restored: SendOperation[] = []
  if (stored !== undefined && stored !== null && stored !== '') {
    if (!Array.isArray(stored) || stored.length > 20) throw Error('待发送记录无法读取')
    restored = stored.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw Error('待发送记录无法读取')
      const item = value as Record<string, unknown>
      if (typeof item.id !== 'string' || !item.id || item.id.length > 128 || typeof item.text !== 'string'
        || !item.text.trim() || item.text.length > 5000 || !['sending', 'uncertain', 'failed'].includes(String(item.state))) throw Error('待发送记录无法读取')
      return { id: item.id, text: item.text, state: 'uncertain', error: '发送结果未确认，点击检查' }
    })
  }
  return new SendOperations({
    now: Date.now,
    valid: () => visible() && session.getRevision() === revision && session.getOpenid() === owner && session.getState() === 'verified',
    send: async (msgId, content) => (await sendMessage({ to: peer, target, msgId, content })).message,
    lookup: (msgId, content) => getSendResult({ to: peer, target, msgId, content }),
    save: operations => {
      if (session.getRevision() !== revision) return
      const entries = listPendingConversations()
      const previous = entries.find(item => item.id === conversation)
      const others = entries.filter(item => item.id !== conversation)
      if (operations.length) {
        if (others.length >= 50) throw Error('请先处理待确认会话')
        wx.setStorageSync(key, operations)
        wx.setStorageSync(indexKey(owner || ''), [...others, { id: conversation, name: displayName, peer: peer || '', target,
          preview: operations[operations.length - 1]!.text.slice(0, 100), at: previous?.at || Date.now() }])
      } else {
        wx.removeStorageSync(key)
        if (others.length) wx.setStorageSync(indexKey(owner || ''), others)
        else wx.removeStorageSync(indexKey(owner || ''))
      }
    }, changed, confirmed,
  }, restored)
}
