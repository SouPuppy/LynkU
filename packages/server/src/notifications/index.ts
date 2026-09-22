import { parseNotificationRequest, parseNotificationPage, parseNotificationIds, parseNotificationCount,
  type NotificationCursor, type NotificationPage } from '@lynku/contracts'
import { refreshNotificationContent, type NotificationContentPort } from './content-preview'

export interface NotificationStore extends NotificationContentPort {
  list(owner: string, unreadOnly: boolean, cursor: NotificationCursor | undefined, take: number): Promise<unknown[]>
  markRead(owner: string, ids: string[]): Promise<unknown>
  unreadCount(owner: string): Promise<unknown>
  identifier(...parts: string[]): string
}
export class InvalidNotificationRequest extends Error {}

export async function listUserNotifications(store: NotificationStore, owner: string, input: unknown): Promise<NotificationPage> {
  let request
  try { request = parseNotificationRequest(input) } catch (_) { throw new InvalidNotificationRequest('Invalid notification request') }
  const scope = store.identifier('notifications', owner, request.unreadOnly ? 'unread' : 'all')
  if (request.cursor && request.cursor.scope !== scope) throw new InvalidNotificationRequest('Invalid notification scope')
  const rows = await store.list(owner, request.unreadOnly, request.cursor, request.limit + 1)
  if (rows.length > request.limit + 1) throw new Error('Unbounded notification response')
  const notifications = rows.slice(0, request.limit).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification record')
    const row = value as Record<string, unknown>
    if (row.to !== owner || (request.unreadOnly && row.read !== false)) throw new Error('Notification scope mismatch')
    if (!(row.created_at instanceof Date) && typeof row.created_at !== 'string') throw new Error('Invalid notification date')
    const createdAt = new Date(row.created_at).toISOString()
    if (request.cursor && (createdAt > request.cursor.createdAt
      || (createdAt === request.cursor.createdAt && (typeof row._id !== 'string' || row._id >= request.cursor.id)))) {
      throw new Error('Notification cursor boundary mismatch')
    }
    return { ...row, _id: row._id, created_at: createdAt }
  })
  const hasMore = rows.length > request.limit
  const last = notifications[notifications.length - 1]
  return parseNotificationPage({ notifications: await refreshNotificationContent(store, notifications), hasMore,
    nextCursor: hasMore && last ? { version: 1, scope, id: last._id, createdAt: last.created_at } : null,
  })
}

export async function markUserNotificationsRead(store: NotificationStore, owner: string, input: unknown): Promise<number> {
  let ids
  try { ids = parseNotificationIds(input) } catch (_) { throw new InvalidNotificationRequest('Invalid notification IDs') }
  const updated = parseNotificationCount(await store.markRead(owner, ids))
  if (updated > ids.length) throw new Error('Unexpected notification update count')
  return updated
}

export async function countUserNotifications(store: NotificationStore, owner: string): Promise<number> {
  return parseNotificationCount(await store.unreadCount(owner))
}
export * from './outbox-lease'
export * from './scheduled-drain'
export * from './content-preview'
export * from './comment-events'
export * from './drain-outbox'
export * from './retry-outbox'
