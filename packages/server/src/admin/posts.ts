import { parseAdminPostQuery, parseAdminPostPage, adminPostPrecedes, adminPostScope, type AdminPostQuery } from '@lynku/contracts'
import { projectAdminPost } from './views'
import { parseAdminPostId, parseAdminPostDetail } from '@lynku/contracts'
export class AdminPostInputFailure extends Error {}
export class AdminPostUnavailable extends Error {}
export async function readAdminPost(store: { read(id: string): Promise<unknown | null> }, input: unknown) {
  let id: string
  try { id = parseAdminPostId(input) } catch { throw new AdminPostInputFailure('Invalid post ID') }
  const value = await store.read(id)
  if (value === null) throw new AdminPostUnavailable('Post unavailable')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid post record')
  const row = value as Record<string, unknown>
  if (row._id !== id) throw Error('Post identity mismatch')
  if (row.status === 'deleted') throw new AdminPostUnavailable('Post unavailable')
  return parseAdminPostDetail({ ...projectAdminPost(row), content: row.content, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at })
}
export async function readAdminPosts(store: { list(query: AdminPostQuery, take: number): Promise<unknown[]> }, input: unknown) {
  let query: AdminPostQuery
  try { query = parseAdminPostQuery(input) } catch { throw new AdminPostInputFailure('Invalid post query') }
  const rows = await store.list(query, query.limit + 1)
  if (rows.length > query.limit + 1) throw Error('Admin post query exceeded bound')
  const posts = rows.map(projectAdminPost)
  posts.forEach((post, i) => {
    const before = i ? posts[i - 1] : query.cursor
    if (post.status !== query.status || !post.title.toLowerCase().includes(query.query.toLowerCase()) || before && !adminPostPrecedes(before, post)) throw Error('Admin post scope mismatch')
  })
  const items = posts.slice(0, query.limit), last = items[items.length - 1]
  return parseAdminPostPage({ items, nextCursor: posts.length > query.limit && last ? { id: last.id, createdAt: last.createdAt, scope: adminPostScope(query) } : null })
}
