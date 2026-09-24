import { ANONYMOUS_AVATAR } from '@lynku/contracts'
type Row = Record<string, unknown>
export interface NotificationContentSources { posts: unknown[]; comments: unknown[] }
export interface NotificationContentPort {
  contentSources(postIds: string[], commentIds: string[]): Promise<NotificationContentSources>
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification content record')
  return value as Row
}
function records(values: unknown[], requested: Set<string>): Map<string, Row> {
  const result = new Map<string, Row>()
  for (const value of values) {
    const item = row(value)
    if (typeof item._id !== 'string' || !requested.has(item._id) || result.has(item._id)) throw new Error('Invalid notification content scope')
    result.set(item._id, item)
  }
  return result
}

/** Public previews are derived from current source visibility, never from an old outbox snapshot. */
export async function refreshNotificationContent<T extends Row>(port: NotificationContentPort, notifications: T[]): Promise<T[]> {
  const postIds = new Set<string>(), commentIds = new Set<string>()
  for (const item of notifications) {
    if (item.type !== 'comment' && item.type !== 'reply') continue
    const target = row(item.target)
    if (typeof target.post_id !== 'string' || typeof target.comment_id !== 'string') throw new Error('Missing notification source')
    postIds.add(target.post_id); commentIds.add(target.comment_id)
  }
  if (!postIds.size) return notifications
  const sources = await port.contentSources([...postIds], [...commentIds])
  const posts = records(sources.posts, postIds), comments = records(sources.comments, commentIds)
  return notifications.map(item => {
    if (item.type !== 'comment' && item.type !== 'reply') return item
    const target = row(item.target)
    const post = posts.get(String(target.post_id)), comment = comments.get(String(target.comment_id))
    const visible = post?.status === 'published' && comment?.status === 'published' && comment.post_id === post._id
    if (!visible) return { ...item, anonymous: true, actor: { nickname: '匿名用户', avatar_url: ANONYMOUS_AVATAR },
      target: { post_id: target.post_id, comment_id: target.comment_id, post_title: '内容已不可用', comment_preview: '' } }
    if (typeof post.title !== 'string' || typeof comment.content !== 'string' || typeof comment.anonymous !== 'boolean') {
      throw new Error('Invalid visible notification content')
    }
    return { ...item, anonymous: item.anonymous === true || comment.anonymous,
      target: { post_id: target.post_id, comment_id: target.comment_id, post_title: post.title, comment_preview: comment.content.slice(0, 100) } }
  })
}
