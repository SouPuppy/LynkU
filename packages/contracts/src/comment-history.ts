import { parseCommentPage, type CommentView, type CommentCursor } from './comment-view'

export interface CommentHistoryCursor { version: 2; post_id: string; created_at: string; id: string }
export interface CommentHistoryPage {
  items: CommentView[]; total: number; hasMore: boolean; nextCursor: CommentHistoryCursor | null; syncCursor: CommentCursor
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid comment history')
  return value as Record<string, unknown>
}
export function parseCommentHistoryCursor(value: unknown, postId: string): CommentHistoryCursor {
  const row = object(value)
  if (row.version !== 2 || row.post_id !== postId || typeof row.id !== 'string' || !row.id || row.id.length > 128
    || typeof row.created_at !== 'string' || new Date(row.created_at).toISOString() !== row.created_at) throw new Error('Invalid comment history cursor')
  return { version: 2, post_id: postId, id: row.id, created_at: row.created_at }
}
export function parseCommentReadRequest(value: unknown) {
  const row = object(value), limit = row.limit === undefined ? 50 : row.limit
  if (typeof row.post_id !== 'string' || !row.post_id || row.post_id.length > 128 || row.post_id.trim() !== row.post_id
    || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || row.offset !== undefined
    || (row.public_only !== undefined && typeof row.public_only !== 'boolean')) throw new Error('Invalid comment read request')
  return { postId: row.post_id, limit, cursor: row.cursor }
}
export function commentPrecedes(a: { created_at: string; _id: string }, b: { created_at: string; _id: string }): boolean {
  return a.created_at < b.created_at || (a.created_at === b.created_at && a._id < b._id)
}
export function parseCommentHistoryPage(value: unknown, postId: string): CommentHistoryPage {
  const row = object(value), page = parseCommentPage({ ...row, comments: row.items }, postId)
  const nextCursor = row.nextCursor === null ? null : parseCommentHistoryCursor(row.nextCursor, postId)
  const sync = object(row.syncCursor), last = page.items[page.items.length - 1]
  if (sync.version !== 1 || sync.post_id !== postId || typeof sync.sequence !== 'number' || !Number.isSafeInteger(sync.sequence) || sync.sequence < 0
    || page.hasMore !== !!nextCursor || (nextCursor && (!last || last._id !== nextCursor.id || last.created_at !== nextCursor.created_at))
    || page.items.some((item, i) => i > 0 && !commentPrecedes(page.items[i - 1]!, item))) throw new Error('Invalid comment history boundary')
  return { ...page, nextCursor, syncCursor: { version: 1, post_id: postId, sequence: sync.sequence } }
}
