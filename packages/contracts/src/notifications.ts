export interface NotificationCursor { version: 1; scope: string; id: string; createdAt: string }
export type NotificationKind = 'comment' | 'reply' | 'like' | 'follow' | 'system'
export interface PublicNotification {
  _id: string
  type: NotificationKind
  actor: { _openid?: string; nickname: string; avatar_url: string }
  anonymous: boolean
  target?: { post_id?: string; comment_id?: string; post_title?: string; comment_preview?: string }
  read: boolean
  created_at: string
}
export interface NotificationPage { notifications: PublicNotification[]; hasMore: boolean; nextCursor: NotificationCursor | null }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification object')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || value.length > max) throw new Error('Invalid notification text')
  return value
}
function timestamp(value: unknown): string {
  const result = text(value, 30)
  const date = new Date(result)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) throw new Error('Invalid notification time')
  return result
}
export function parseNotificationCursor(value: unknown): NotificationCursor {
  const input = object(value)
  if (input.version !== 1 || typeof input.scope !== 'string' || !/^[a-f0-9]{64}$/.test(input.scope)) throw new Error('Invalid notification cursor')
  return { version: 1, scope: input.scope, id: text(input.id, 128), createdAt: timestamp(input.createdAt) }
}
export function parseNotificationRequest(value: unknown): { limit: number; unreadOnly: boolean; cursor?: NotificationCursor } {
  const input = object(value)
  const limit = input.limit === undefined ? 20 : input.limit
  const unreadOnly = input.unreadOnly === undefined ? false : input.unreadOnly
  if (input.before !== undefined || typeof unreadOnly !== 'boolean' || typeof limit !== 'number'
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid notification request')
  return input.cursor === undefined ? { limit, unreadOnly } : { limit, unreadOnly, cursor: parseNotificationCursor(input.cursor) }
}
export function parsePublicNotification(value: unknown): PublicNotification {
  const input = object(value)
  const type = input.type
  if (typeof type !== 'string' || !['comment', 'reply', 'like', 'follow', 'system'].includes(type)
    || typeof input.anonymous !== 'boolean' || typeof input.read !== 'boolean') throw new Error('Invalid notification state')
  const actor = input.anonymous ? { nickname: '匿名用户', avatar_url: '/assets/anonymous.png' } : object(input.actor)
  const result: PublicNotification = {
    _id: text(input._id, 128), type: type as NotificationKind, anonymous: input.anonymous, read: input.read,
    actor: { nickname: text(actor.nickname, 100), avatar_url: text(actor.avatar_url, 2048, true) },
    created_at: timestamp(input.created_at),
  }
  if (!input.anonymous && '_openid' in actor && actor._openid !== undefined) result.actor._openid = text(actor._openid, 128)
  if (input.target !== undefined) {
    const target = object(input.target)
    result.target = {}
    for (const key of ['post_id', 'comment_id', 'post_title', 'comment_preview'] as const) {
      if (target[key] !== undefined) result.target[key] = text(target[key], key.endsWith('_id') ? 128 : 5000, true)
    }
  }
  return result
}
export function parseNotificationPage(value: unknown): NotificationPage {
  const input = object(value)
  if (!Array.isArray(input.notifications) || input.notifications.length > 50 || typeof input.hasMore !== 'boolean') throw new Error('Invalid notification page')
  const cursor = input.nextCursor === null ? null : parseNotificationCursor(input.nextCursor)
  if (input.hasMore !== (cursor !== null) || (input.hasMore && !input.notifications.length)) throw new Error('Invalid notification boundary')
  const notifications = input.notifications.map(parsePublicNotification)
  const ids = new Set<string>()
  for (let index = 0; index < notifications.length; index++) {
    const item = notifications[index]!
    const previous = notifications[index - 1]
    if (ids.has(item._id) || (previous && (previous.created_at < item.created_at
      || (previous.created_at === item.created_at && previous._id <= item._id)))) throw new Error('Invalid notification order')
    ids.add(item._id)
  }
  const last = notifications[notifications.length - 1]
  if (cursor && (cursor.id !== last?._id || cursor.createdAt !== last?.created_at)) throw new Error('Invalid notification boundary')
  return { notifications, hasMore: input.hasMore, nextCursor: cursor }
}
export function parseNotificationIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('Invalid notification IDs')
  return [...new Set(value.map(id => text(id, 128)))]
}
export function parseNotificationCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid notification count')
  return value
}
