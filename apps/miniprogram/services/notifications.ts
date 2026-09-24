// services/notifications.ts — Notification data access
import { callCloud, CloudCallError } from './cloud'
import { getRevision, getOpenid, getState } from './session'
import { parseNotificationPage, parseNotificationIds, parseNotificationCount, parseReadResult } from '../generated/contracts/index'
import type { NotificationCursor, NotificationPage } from '../generated/contracts/index'
export type { NotificationCursor } from '../generated/contracts/index'

/** List notifications with cursor-based pagination */
export async function listNotifications(
  cursor?: NotificationCursor,
  limit = 20,
): Promise<NotificationPage> {
  const res = await callCloud<unknown>(
    'messages',
    { action: 'listNotifications', cursor, limit },
  )
  try { return parseNotificationPage(res) } catch (_) {
    throw new CloudCallError('通知列表返回了无效数据', 'INVALID_RESPONSE', 'messages', 'listNotifications')
  }
}

/** Mark explicit loaded notifications in bounded, account-scoped batches. */
async function writeNotificationsRead(notificationIds: string[]): Promise<number> {
  const revision = getRevision()
  const ids = [...new Set(notificationIds)]
  let updated = 0
  for (let offset = 0; offset < ids.length; offset += 100) {
    if (revision !== getRevision()) throw new Error('会话已变更')
    const batch = parseNotificationIds(ids.slice(offset, offset + 100))
    const res = await callCloud<unknown>('messages', { action: 'markNotificationsRead', notificationIds: batch })
    if (revision !== getRevision()) throw new Error('会话已变更')
    try { updated += parseReadResult(res, batch.length) } catch (_) {
      throw new CloudCallError('通知已读返回了无效数据', 'INVALID_RESPONSE', 'messages', 'markNotificationsRead')
    }
  }
  return updated
}

let readsActive = true
const drains = new Map<string, Promise<void>>()
const keyFor = (owner: string) => `notification_reads_v1:${encodeURIComponent(owner)}`
function pendingReads(owner: string): string[] {
  const value: unknown = wx.getStorageSync(keyFor(owner))
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value) || value.length > 2000 || value.some(id => typeof id !== 'string' || !id || id.length > 128)) throw Error('通知已读记录无法读取')
  return value as string[]
}
export function setNotificationReadsActive(value: boolean): void { readsActive = value }
export async function markNotificationsRead(notificationIds: string[]): Promise<number> {
  const owner = getOpenid()
  if (!owner || getState() !== 'verified') throw Error('会话已变更')
  const ids = [...new Set([...pendingReads(owner), ...notificationIds])]
  if (ids.length > 2000) throw Error('待同步记录过多，请稍后重试')
  wx.setStorageSync(keyFor(owner), ids)
  await flushNotificationReads()
  if (notificationIds.some(id => pendingReads(owner).includes(id))) throw Error('已读状态等待同步')
  return notificationIds.length
}
export async function flushNotificationReads(): Promise<void> {
  const owner = getOpenid(), revision = getRevision()
  if (!owner || getState() !== 'verified' || !readsActive) return
  const running = drains.get(owner)
  if (running) return running
  const work = (async () => {
    const ids = pendingReads(owner).slice(0, 100)
    if (!ids.length) return
    await writeNotificationsRead(ids)
    if (revision !== getRevision()) return
    const written = new Set(ids)
    const remaining = pendingReads(owner).filter(id => !written.has(id))
    if (remaining.length) wx.setStorageSync(keyFor(owner), remaining)
    else wx.removeStorageSync(keyFor(owner))
  })()
  drains.set(owner, work)
  try { await work } finally { drains.delete(owner) }
}

/** Get unread notification count */
export async function getUnreadCount(): Promise<number> {
  const res = await callCloud<unknown>('messages', {
    action: 'getUnreadNotificationCount',
  })
  try {
    if (!res || typeof res !== 'object' || !('count' in res)) throw new Error('Invalid count')
    return parseNotificationCount(res.count)
  } catch (_) { throw new CloudCallError('未读数量返回了无效数据', 'INVALID_RESPONSE', 'messages', 'getUnreadNotificationCount') }
}
