type Row = Record<string, unknown>
export interface CommentNotification {
  type: 'comment' | 'reply'; to: string; actor: Row; anonymous: boolean
  target: { post_id: string; comment_id: string; post_title: string; comment_preview: string }
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid notification source')
  return value as Row
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw Error('Invalid notification source field')
  return value
}
export function commentNotificationEvents(commentValue: unknown, postValue: unknown, parentValue: unknown | null): CommentNotification[] {
  const comment = row(commentValue), post = row(postValue), parent = parentValue === null ? null : row(parentValue)
  const actorId = text(comment._openid), owner = text(post._openid)
  const actor = row(comment.author)
  if (actor._openid !== actorId || typeof comment.anonymous !== 'boolean' || comment.status !== 'published') throw Error('Invalid notification actor')
  const notifications: CommentNotification[] = []
  const add = (type: 'comment' | 'reply', to: string) => notifications.push({ type, to,
    actor: comment.anonymous ? { _openid: actorId } : { _openid: actorId, nickname: text(actor.nickname), avatar_url: actor.avatar_url, profile_version: actor.profile_version },
    anonymous: comment.anonymous as boolean,
    target: { post_id: text(post._id), comment_id: text(comment._id), post_title: text(post.title), comment_preview: text(comment.content).slice(0, 100) } })
  if (comment.depth === 0) { if (owner !== actorId) add('comment', owner) }
  else if (comment.depth === 1 && parent) {
    const parentOwner = text(parent._openid)
    if (parentOwner !== actorId) add('reply', parentOwner)
    if (owner !== actorId && owner !== parentOwner) add('comment', owner)
  } else throw Error('Invalid comment notification depth')
  return notifications
}
export interface NotificationWriteStore {
  identifier(...parts: string[]): string
  now(): unknown
  run<T>(work: (tx: {
    read(id: string): Promise<unknown | null>
    put(id: string, data: Row): Promise<void>
    remove(id: string): Promise<void>
    source(postId: string, commentId: string): Promise<{ post: unknown; comment: unknown; parent: unknown | null } | null>
  }) => Promise<T>): Promise<T>
}
export async function deliverCommentNotification(store: NotificationWriteStore, input: unknown): Promise<void> {
  const notification = row(input), target = row(notification.target), actor = row(notification.actor)
  if (notification.type !== 'comment' && notification.type !== 'reply') throw Error('Invalid notification event')
  const recipient = text(notification.to), actorId = text(actor._openid)
  if (typeof notification.anonymous !== 'boolean') throw Error('Invalid notification visibility')
  // All inputs to a public ID are already visible to this recipient; no hidden actor oracle.
  const id = store.identifier('notification', 'v2', notification.type, recipient, text(target.comment_id))
  const legacyId = store.identifier('notification', notification.type, recipient, actorId, text(target.comment_id))
  await store.run(async tx => {
    const existing = await tx.read(id)
    if (existing !== null) return
    const legacy = await tx.read(legacyId)
    if (legacy !== null) {
      const { _id: ignored, ...saved } = row(legacy)
      await tx.put(id, saved)
      await tx.remove(legacyId)
      return
    }
    const source = await tx.source(text(target.post_id), text(target.comment_id))
    if (!source) return
    const post = row(source.post), comment = row(source.comment)
    if (post.status !== 'published' || comment.status !== 'published' || comment.post_id !== post._id) return
    const current = commentNotificationEvents(comment, post, source.parent)
      .find(event => event.to === recipient && event.type === notification.type)
    if (!current || row(current.actor)._openid !== actorId) return
    const anonymous = notification.anonymous === true || current.anonymous
    await tx.put(id, { type: current.type, to: recipient, anonymous,
      actor: anonymous ? { _openid: actorId } : current.actor,
      target: current.target, read: false, created_at: comment.created_at || store.now(), delivered_at: store.now() })
  })
}
