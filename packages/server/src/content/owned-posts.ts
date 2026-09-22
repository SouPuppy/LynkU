import { parseOwnedPostRequest, parseOwnedPostPage, postPrecedes, type OwnedPostCursor, type OwnedPostPage } from '@lynku/contracts'
import { projectPost } from './post-view'
import { PostReadFailure } from './read-post'

export interface OwnedPostStore {
  identifier(...parts: string[]): string
  list(owner: string, cursor: OwnedPostCursor | null, take: number): Promise<unknown[]>
  count(owner: string): Promise<number>
}
export async function listOwnedPosts(store: OwnedPostStore, owner: string, input: unknown): Promise<OwnedPostPage> {
  if (!owner) throw new PostReadFailure('FORBIDDEN')
  let request
  try { request = parseOwnedPostRequest(input) } catch (_) { throw new PostReadFailure('INVALID_INPUT') }
  const scope = store.identifier('owned-posts', owner)
  if (request.cursor && request.cursor.scope !== scope) throw new PostReadFailure('INVALID_INPUT')
  const [rows, total] = await Promise.all([store.list(owner, request.cursor, request.limit + 1), store.count(owner)])
  if (rows.length > request.limit + 1) throw new Error('Unbounded owned post page')
  const projected = rows.map(row => projectPost(row, owner))
  for (let i = 0; i < projected.length; i++) {
    const item = projected[i]!
    const before = i ? projected[i - 1] : request.cursor && { _id: request.cursor.id, created_at: request.cursor.createdAt }
    if (!item.is_mine || (before && !postPrecedes(before, item))) throw new Error('Invalid owned post query boundary')
  }
  const items = projected.slice(0, request.limit)
  const hasMore = projected.length > request.limit
  const last = items[items.length - 1]
  return parseOwnedPostPage({ items, total, hasMore,
    nextCursor: hasMore && last ? { version: 1, scope, id: last._id, createdAt: last.created_at } : null })
}
