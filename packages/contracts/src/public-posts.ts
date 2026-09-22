import { parseOwnedPostCursor, postPrecedes, type OwnedPostCursor } from './owned-posts'
import { parsePostPage, type PostView } from './post-view'

export type PostCursor = OwnedPostCursor
export interface PublicPostRequest {
  categoryId: string; authorId: string; query: string; limit: number; cursor: PostCursor | null
}
export interface PublicPostPage { items: PostView[]; total: number; hasMore: boolean; nextCursor: PostCursor | null }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid public post request')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > max || value.trim() !== value) throw new Error('Invalid post filter')
  return value
}
export function parsePublicPostRequest(value: unknown, search: boolean): PublicPostRequest {
  const row = object(value)
  const limit = row.limit === undefined ? 20 : row.limit
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || row.offset !== undefined
    || (row.public_only !== undefined && typeof row.public_only !== 'boolean')) throw new Error('Invalid post pagination')
  const query = text(row.query, 200)
  const categoryId = text(row.category_id, 128), authorId = text(row.author_openid, 128)
  if (search ? (!query || categoryId || authorId) : query) throw new Error('Invalid post query scope')
  return { categoryId, authorId, query, limit, cursor: row.cursor == null ? null : parseOwnedPostCursor(row.cursor) }
}
export function parsePublicPostPage(value: unknown): PublicPostPage {
  const row = object(value), page = parsePostPage(value)
  const nextCursor = row.nextCursor === null ? null : parseOwnedPostCursor(row.nextCursor)
  const last = page.items[page.items.length - 1]
  if (page.hasMore !== !!nextCursor || (nextCursor && (!last || nextCursor.id !== last._id || nextCursor.createdAt !== last.created_at))
    || page.items.some((item, i) => i > 0 && !postPrecedes(page.items[i - 1]!, item))) throw new Error('Invalid post page boundary')
  return { ...page, nextCursor }
}
