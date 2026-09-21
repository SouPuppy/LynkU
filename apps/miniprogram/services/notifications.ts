// services/notifications.ts — Notification data access
import { callCloud, CloudCallError } from './cloud'
import { getRevision } from './session'
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
export async function markNotificationsRead(notificationIds: string[]): Promise<number> {
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
