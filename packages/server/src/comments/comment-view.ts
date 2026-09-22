import { parseCommentView, type CommentView } from '@lynku/contracts'
/** Explicit public projection: stored retry keys and future private fields never cross this boundary. */

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored comment')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored comment field')
  return value
}

export function projectComment(value: unknown, viewer: string): CommentView {
  const row = record(value)
  const owner = text(row._openid)
  if (!owner || !text(row._id) || !text(row.post_id)) throw new Error('Invalid comment identity')
  if (row.depth !== 0 && row.depth !== 1) throw new Error('Invalid comment depth')
  if (typeof row.anonymous !== 'boolean') throw new Error('Invalid comment anonymity')
  if (!['published', 'deleted', 'flagged'].includes(text(row.status))) throw new Error('Invalid comment status')
  const status = row.status as CommentView['status']
  const created = typeof row.created_at === 'string' ? new Date(row.created_at) : new Date(Date.prototype.getTime.call(row.created_at))
  const hidden = status !== 'published'
  const author = hidden || row.anonymous ? null : record(row.author)
  return parseCommentView({
    _id: text(row._id), post_id: text(row.post_id),
    parent_id: row.parent_id === null ? null : text(row.parent_id), depth: row.depth,
    content: hidden ? '' : text(row.content), anonymous: row.anonymous,
    is_mine: !!viewer && viewer === owner, status, created_at: created.toISOString(),
    ...(!hidden && !row.anonymous ? { _openid: owner } : {}),
    author: hidden ? { nickname: '已删除', avatar_url: '' }
      : row.anonymous ? { nickname: '匿名用户', avatar_url: '/assets/anonymous.png' }
        : { nickname: text(author?.nickname), avatar_url: text(author?.avatar_url) },
  })
}
