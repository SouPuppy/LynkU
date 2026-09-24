import { ANONYMOUS_AVATAR } from './avatar'
export interface CommentView {
  _id: string
  _openid?: string
  post_id: string
  parent_id: string | null
  depth: 0 | 1
  content: string
  anonymous: boolean
  is_mine: boolean
  status: 'published' | 'deleted' | 'flagged'
  created_at: string
  author: { _openid?: string; nickname: string; avatar_url: string }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid comment response')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || value.length > max) throw new Error('Invalid comment text')
  return value
}
export function parseCommentView(value: unknown): CommentView {
  const row = object(value)
  if ((row.depth !== 0 && row.depth !== 1) || typeof row.anonymous !== 'boolean' || typeof row.is_mine !== 'boolean'
    || (row.status !== 'published' && row.status !== 'deleted' && row.status !== 'flagged')) throw new Error('Invalid comment state')
  const created = text(row.created_at, 30)
  if (new Date(created).toISOString() !== created) throw new Error('Invalid comment time')
  const hidden = row.status !== 'published'
  const author = hidden ? { nickname: '已删除', avatar_url: '' }
    : row.anonymous ? { nickname: '匿名用户', avatar_url: ANONYMOUS_AVATAR } : object(row.author)
  const result: CommentView = { _id: text(row._id, 128), post_id: text(row.post_id, 128),
    parent_id: row.parent_id === null ? null : text(row.parent_id, 128), depth: row.depth,
    content: hidden ? '' : text(row.content, 2000), anonymous: row.anonymous, is_mine: row.is_mine,
    status: row.status, created_at: created,
    author: { nickname: text(author.nickname, 100), avatar_url: text(author.avatar_url, 2048, true) } }
  if (!hidden && !row.anonymous) result._openid = text(row._openid, 128)
  return result
}

export function parseCommentPage(value: unknown, postId: string) {
  const row = object(value)
  if (!Array.isArray(row.comments) || row.comments.length > 100 || typeof row.total !== 'number'
    || !Number.isSafeInteger(row.total) || row.total < row.comments.length || typeof row.hasMore !== 'boolean') throw new Error('Invalid comment page')
  const items = row.comments.map(parseCommentView)
  if (new Set(items.map(item => item._id)).size !== items.length
    || items.some(item => item.post_id !== postId || item.status === 'flagged')) throw new Error('Invalid comment page scope')
  return { items, total: row.total, hasMore: row.hasMore }
}

export interface CommentCursor { version: 1; post_id: string; sequence: number }
export function parseCommentSyncPage(value: unknown, after: CommentCursor) {
  const row = object(value)
  if (!Array.isArray(row.changes) || row.changes.length > 100 || typeof row.has_more !== 'boolean') throw new Error('Invalid comment changes')
  let sequence = after.sequence
  const changes = row.changes.map<{ comment_id: string; sequence: number; type: 'created' | 'deleted'; comment: CommentView | null }>(value => {
    const change = object(value)
    if (typeof change.sequence !== 'number' || !Number.isSafeInteger(change.sequence) || change.sequence <= sequence
      || (change.type !== 'created' && change.type !== 'deleted')) throw new Error('Invalid comment change order')
    sequence = change.sequence
    const id = text(change.comment_id, 128)
    const comment = change.comment === null ? null : parseCommentView(change.comment)
    if (comment && (comment._id !== id || comment.post_id !== after.post_id)) throw new Error('Invalid comment change scope')
    return { comment_id: id, sequence, type: change.type, comment }
  })
  const next = object(row.next_cursor)
  if (next.version !== 1 || next.post_id !== after.post_id || next.sequence !== sequence
    || (row.has_more && changes.length === 0)) throw new Error('Invalid comment sync boundary')
  const nextCursor: CommentCursor = { version: 1, post_id: after.post_id, sequence }
  return { changes, nextCursor, hasMore: row.has_more }
}
