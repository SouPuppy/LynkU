import { parsePostPage, type PostView } from './post-view'

export interface OwnedPostCursor { version: 1; scope: string; createdAt: string; id: string }
export interface OwnedPostPage { items: PostView[]; total: number; hasMore: boolean; nextCursor: OwnedPostCursor | null }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid owned post page')
  return value as Record<string, unknown>
}
export function parseOwnedPostCursor(value: unknown): OwnedPostCursor {
  const row = record(value)
  if (row.version !== 1 || typeof row.scope !== 'string' || !/^[a-f0-9]{64}$/.test(row.scope)
    || typeof row.id !== 'string' || !row.id || row.id.length > 128
    || typeof row.createdAt !== 'string' || new Date(row.createdAt).toISOString() !== row.createdAt) throw new Error('Invalid owned post cursor')
  return { version: 1, scope: row.scope, createdAt: row.createdAt, id: row.id }
}
export function parseOwnedPostRequest(value: unknown): { limit: number; cursor: OwnedPostCursor | null } {
  const row = record(value)
  const limit = row.limit === undefined ? 20 : row.limit
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || row.offset !== undefined || (row.public_only !== undefined && row.public_only !== false)) throw new Error('Invalid owned post request')
  return { limit, cursor: row.cursor == null ? null : parseOwnedPostCursor(row.cursor) }
}
export function postPrecedes(a: { created_at: string; _id: string }, b: { created_at: string; _id: string }): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a._id > b._id)
}
export function parseOwnedPostPage(value: unknown): OwnedPostPage {
  const row = record(value)
  const page = parsePostPage(value, 'owner')
  const nextCursor = row.nextCursor === null ? null : parseOwnedPostCursor(row.nextCursor)
  const last = page.items[page.items.length - 1]
  if (page.hasMore !== !!nextCursor || (nextCursor && (!last || nextCursor.id !== last._id || nextCursor.createdAt !== last.created_at))
    || page.items.some((item, i) => i > 0 && !postPrecedes(page.items[i - 1]!, item))) throw new Error('Invalid owned post boundary')
  return { ...page, nextCursor }
}
