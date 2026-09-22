import { parseCommentReadRequest, parseCommentHistoryCursor, commentPrecedes, type CommentHistoryCursor } from './comment-history'
export interface AdminComment { _id: string; post_id: string; parent_id: string | null; depth: 0 | 1; content: string; anonymous: boolean; authorLabel: string; status: 'published' | 'deleted' | 'flagged'; created_at: string }
export interface AdminCommentPage { items: AdminComment[]; nextCursor: CommentHistoryCursor | null }
export interface AdminCommentDetail extends AdminComment { versionToken: string }
export function parseAdminCommentDetail(value: unknown): AdminCommentDetail {
  const input = object(value), postId = text(input.post_id, 128), versionToken = text(input.versionToken, 64)
  if (!/^[a-f0-9]{64}$/.test(versionToken)) throw Error('Invalid comment version token')
  const item = parseAdminCommentPage({ items: [input], nextCursor: null }, postId).items[0]!
  return { ...item, versionToken }
}
export function parseAdminCommentRequest(input: unknown) {
  const request = parseCommentReadRequest(input)
  if (request.limit > 50) throw Error('Admin comment limit exceeded')
  return { ...request, cursor: request.cursor == null ? null : parseCommentHistoryCursor(request.cursor, request.postId) }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid admin comment')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || !empty && !value || value.length > max) throw Error('Invalid admin comment field')
  return value
}
export function parseAdminCommentPage(value: unknown, postId: string): AdminCommentPage {
  const row = object(value)
  if (!Array.isArray(row.items) || row.items.length > 50) throw Error('Invalid admin comment page')
  const items = row.items.map<AdminComment>(value => {
    const item = object(value)
    if (item.post_id !== postId || typeof item.anonymous !== 'boolean' || item.depth !== 0 && item.depth !== 1
      || item.status !== 'published' && item.status !== 'flagged' && item.status !== 'deleted') throw Error('Invalid admin comment scope')
    const created_at = text(item.created_at, 24)
    if (!Number.isFinite(Date.parse(created_at)) || new Date(created_at).toISOString() !== created_at) throw Error('Invalid comment date')
    const parent_id = item.parent_id === null ? null : text(item.parent_id, 128)
    if (item.depth === 0 && parent_id !== null || item.depth === 1 && parent_id === null) throw Error('Invalid reply relationship')
    return { _id: text(item._id, 128), post_id: postId, parent_id, depth: item.depth, created_at, status: item.status, anonymous: item.anonymous,
      content: item.status === 'published' ? text(item.content, 2000) : '', authorLabel: item.status !== 'published' ? '不展示' : item.anonymous ? '匿名用户' : text(item.authorLabel, 100) }
  })
  const nextCursor = row.nextCursor === null ? null : parseCommentHistoryCursor(row.nextCursor, postId), last = items[items.length - 1]
  if (items.some((item, i) => i > 0 && !commentPrecedes(items[i - 1]!, item)) || nextCursor && (!last || last._id !== nextCursor.id || last.created_at !== nextCursor.created_at)) throw Error('Invalid comment ordering')
  return { items, nextCursor }
}
