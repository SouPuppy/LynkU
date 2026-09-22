import { parseAdminCommentRequest, parseAdminCommentPage, commentPrecedes } from '@lynku/contracts'
import { projectComment } from './comment-view'
export class AdminCommentFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND') { super(code) }
}
export async function readAdminComments(store: {
  post(id: string): Promise<unknown | null>
  list(request: ReturnType<typeof parseAdminCommentRequest>, take: number): Promise<unknown[]>
}, input: unknown) {
  let request: ReturnType<typeof parseAdminCommentRequest>
  try { request = parseAdminCommentRequest(input) } catch { throw new AdminCommentFailure('INVALID_INPUT') }
  async function requirePost() {
    const value = await store.post(request.postId)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminCommentFailure('NOT_FOUND')
    const row = value as Record<string, unknown>
    if (row._id !== request.postId) throw Error('Post scope mismatch')
    if (row.status === 'deleted') throw new AdminCommentFailure('NOT_FOUND')
    if (row.status !== 'published' && row.status !== 'hidden' && row.status !== 'flagged') throw Error('Invalid post status')
  }
  await requirePost()
  const values = await store.list(request, request.limit + 1)
  if (values.length > request.limit + 1) throw Error('Unbounded admin comment query')
  const comments = values.map(value => projectComment(value, ''))
  comments.forEach((item, i) => {
    const before = i ? comments[i - 1] : request.cursor && { _id: request.cursor.id, created_at: request.cursor.created_at }
    if (item.post_id !== request.postId || before && !commentPrecedes(before, item)) throw Error('Comment query scope mismatch')
  })
  await requirePost()
  const items = comments.slice(0, request.limit).map(item => ({ _id: item._id, post_id: item.post_id, parent_id: item.parent_id, depth: item.depth,
    content: item.content, anonymous: item.anonymous, authorLabel: item.author.nickname, status: item.status, created_at: item.created_at }))
  const last = items[items.length - 1]
  return parseAdminCommentPage({ items, nextCursor: comments.length > request.limit && last ? { version: 2, post_id: request.postId, id: last._id, created_at: last.created_at } : null }, request.postId)
}
