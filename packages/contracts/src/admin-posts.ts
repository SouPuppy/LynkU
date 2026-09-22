export type AdminPostStatus = 'published' | 'flagged' | 'hidden' | 'deleted'
export interface AdminPostSummary { id: string; title: string; categoryId: string; anonymous: boolean; authorLabel: string; status: AdminPostStatus; createdAt: string; commentCount: number; revision: number }
export interface AdminPostCursor { scope: string; id: string; createdAt: string }
export interface AdminPostQuery { query: string; status: AdminPostStatus; limit: number; cursor: AdminPostCursor | null }
export interface AdminPostPage { items: AdminPostSummary[]; nextCursor: AdminPostCursor | null }
export interface AdminPostDetail extends AdminPostSummary { content: string; updatedAt: string; governanceCaseId: string | null }
export function parseAdminPostId(value: unknown): string {
  const id = text(object(value).id, 128)
  if (!id || id.trim() !== id || /[\x00-\x1f]/.test(id)) throw Error('Invalid post ID')
  return id
}
export function parseAdminPostDetail(value: unknown): AdminPostDetail {
  const summary = parseAdminPostSummary(value), row = object(value)
  if (summary.status === 'deleted') throw Error('Deleted body is unavailable')
  const governanceCaseId = row.governanceCaseId === null ? null : text(row.governanceCaseId, 128)
  return { ...summary, content: text(row.content, POST_CONTENT_LIMIT), updatedAt: timestamp(row.updatedAt), governanceCaseId }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid admin post payload')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw Error('Invalid admin post text')
  return value
}
function timestamp(value: unknown): string {
  const result = text(value, 24)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw Error('Invalid admin post timestamp')
  return result
}
function statusOf(value: unknown): AdminPostStatus {
  if (value !== 'published' && value !== 'flagged' && value !== 'hidden' && value !== 'deleted') throw Error('Invalid admin post status')
  return value
}
export function adminPostScope(query: Pick<AdminPostQuery, 'query' | 'status'>): string { return JSON.stringify(['admin-posts:1', query.query, query.status]) }
function cursorOf(value: unknown): AdminPostCursor {
  const row = object(value), id = text(row.id, 128)
  if (!id) throw Error('Invalid post cursor')
  return { id, createdAt: timestamp(row.createdAt), scope: text(row.scope, 512) }
}
export function parseAdminPostQuery(value: unknown): AdminPostQuery {
  const row = object(value), query = text(row.query ?? '', 80), status = statusOf(row.status ?? 'published'), limit = row.limit ?? 25
  if (query.trim() !== query || status === 'deleted' && query || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || row.offset !== undefined) throw Error('Invalid admin post filter')
  const result = { query, status, limit, cursor: row.cursor == null ? null : cursorOf(row.cursor) }
  if (result.cursor && result.cursor.scope !== adminPostScope(result)) throw Error('Post cursor scope mismatch')
  return result
}
export function parseAdminPostSummary(value: unknown): AdminPostSummary {
  const row = object(value), status = statusOf(row.status)
  if (typeof row.anonymous !== 'boolean' || typeof row.commentCount !== 'number' || !Number.isSafeInteger(row.commentCount) || row.commentCount < 0
    || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) throw Error('Invalid admin post state')
  const id = text(row.id, 128)
  if (!id) throw Error('Invalid admin post ID')
  return { id, title: status === 'deleted' ? '已删除内容' : text(row.title, 200), categoryId: text(row.categoryId, 128), anonymous: row.anonymous,
    authorLabel: status === 'deleted' ? '不展示' : row.anonymous ? '匿名内容' : text(row.authorLabel, 100), status, createdAt: timestamp(row.createdAt), commentCount: row.commentCount, revision: row.revision }
}
export function adminPostPrecedes(a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): boolean { return a.createdAt > b.createdAt || a.createdAt === b.createdAt && a.id > b.id }
export function parseAdminPostPage(value: unknown): AdminPostPage {
  const row = object(value)
  if (!Array.isArray(row.items) || row.items.length > 50) throw Error('Invalid admin post page')
  const items = row.items.map(parseAdminPostSummary), last = items[items.length - 1], nextCursor = row.nextCursor === null ? null : cursorOf(row.nextCursor)
  if (items.some((item, i) => i > 0 && !adminPostPrecedes(items[i - 1]!, item)) || nextCursor && (!last || last.id !== nextCursor.id || last.createdAt !== nextCursor.createdAt)) throw Error('Invalid admin post ordering')
  return { items, nextCursor }
}
import { POST_CONTENT_LIMIT } from './content-limits'
