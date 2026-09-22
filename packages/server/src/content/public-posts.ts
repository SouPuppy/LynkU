import { parsePublicPostRequest, parsePublicPostPage, postPrecedes, type PublicPostRequest, type PublicPostPage } from '@lynku/contracts'
import { projectPost } from './post-view'
import { PostReadFailure } from './read-post'

export interface PublicPostStore {
  identifier(...parts: string[]): string
  list(request: PublicPostRequest, take: number): Promise<unknown[]>
  count(request: PublicPostRequest): Promise<number>
}
export async function listPublicPosts(store: PublicPostStore, viewer: string, input: unknown, search = false): Promise<PublicPostPage> {
  let request
  try { request = parsePublicPostRequest(input, search) } catch (_) { throw new PostReadFailure('INVALID_INPUT') }
  const scope = store.identifier('public-posts:2', request.categoryId, request.authorId, request.query)
  if (request.cursor && request.cursor.scope !== scope) throw new PostReadFailure('INVALID_INPUT')
  const [rows, count] = await Promise.all([store.list(request, request.limit + 1), store.count(request)])
  if (rows.length > request.limit + 1 || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid post query result')
  const projected = rows.map(row => projectPost(row, viewer))
  for (let i = 0; i < projected.length; i++) {
    const item = projected[i]!
    const before = i ? projected[i - 1] : request.cursor && { _id: request.cursor.id, created_at: request.cursor.createdAt }
    if (item.status !== 'published' || (request.categoryId && item.category_id !== request.categoryId)
      || (request.authorId && (item.anonymous || item._openid !== request.authorId))
      || (request.query && !`${item.title}\n${item.content}`.toLowerCase().includes(request.query.toLowerCase()))
      || (before && !postPrecedes(before, item))) throw new Error('Invalid public post query scope')
  }
  const items = projected.slice(0, request.limit), hasMore = projected.length > request.limit
  const last = items[items.length - 1]
  // The count is an estimate from a separate read; concurrent deletion cannot invalidate a valid page.
  return parsePublicPostPage({ items, total: Math.max(count, items.length), hasMore,
    nextCursor: hasMore && last ? { version: 1, scope, id: last._id, createdAt: last.created_at } : null })
}
