import { parseCommentReadRequest, parseCommentHistoryCursor, parseCommentHistoryPage, commentPrecedes,
  parseCommentSyncPage, type CommentHistoryCursor, type CommentHistoryPage, type CommentCursor } from '@lynku/contracts'
import { projectComment } from './comment-view'
import { nextCommentSequence } from './write-comment'

export class CommentReadFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'POST_NOT_FOUND') { super(code) }
}
export interface CommentReadStore {
  post(id: string): Promise<unknown | null>
  counter(id: string): Promise<unknown | null>
  history(postId: string, cursor: CommentHistoryCursor | null, take: number): Promise<unknown[]>
  count(postId: string): Promise<number>
  changes(postId: string, after: number, take: number): Promise<unknown[]>
  comment(id: string): Promise<unknown | null>
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored comment row')
  return value as Record<string, unknown>
}
async function requirePost(store: CommentReadStore, id: string): Promise<void> {
  const value = await store.post(id)
  if (value === null || row(value).status !== 'published') throw new CommentReadFailure('POST_NOT_FOUND')
  if (row(value)._id !== id) throw new Error('Invalid comment parent scope')
}
export async function readCommentHistory(store: CommentReadStore, viewer: string, input: unknown): Promise<CommentHistoryPage> {
  let request, cursor
  try {
    request = parseCommentReadRequest(input)
    cursor = request.cursor == null ? null : parseCommentHistoryCursor(request.cursor, request.postId)
  } catch (_) { throw new CommentReadFailure('INVALID_INPUT') }
  await requirePost(store, request.postId)
  // Read the watermark BEFORE the snapshot. Concurrent commits are replayed and merged by ID, never skipped.
  const sequence = nextCommentSequence(await store.counter(request.postId)) - 1
  const [values, count] = await Promise.all([store.history(request.postId, cursor, request.limit + 1), store.count(request.postId)])
  if (values.length > request.limit + 1 || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid comment page size')
  const projected = values.map(value => projectComment(value, viewer))
  for (let i = 0; i < projected.length; i++) {
    const item = projected[i]!, prior = i ? projected[i - 1] : cursor && { _id: cursor.id, created_at: cursor.created_at }
    if (item.post_id !== request.postId || item.status === 'flagged' || (prior && !commentPrecedes(prior, item))) throw new Error('Invalid comment history scope')
  }
  const items = projected.slice(0, request.limit), hasMore = projected.length > request.limit, last = items[items.length - 1]
  return parseCommentHistoryPage({ items, total: Math.max(count, items.length), hasMore,
    nextCursor: hasMore && last ? { version: 2, post_id: request.postId, id: last._id, created_at: last.created_at } : null,
    syncCursor: { version: 1, post_id: request.postId, sequence } }, request.postId)
}
export async function readCommentChanges(store: CommentReadStore, viewer: string, input: unknown) {
  let request, cursor: CommentCursor
  try {
    request = parseCommentReadRequest(input)
    const raw = row(request.cursor)
    if (raw.version !== 1 || raw.post_id !== request.postId || typeof raw.sequence !== 'number'
      || !Number.isSafeInteger(raw.sequence) || raw.sequence < 0) throw new Error('Invalid sequence')
    cursor = { version: 1, post_id: request.postId, sequence: raw.sequence }
  } catch (_) { throw new CommentReadFailure('INVALID_INPUT') }
  await requirePost(store, request.postId)
  const changes = await store.changes(request.postId, cursor.sequence, request.limit + 1)
  if (changes.length > request.limit + 1) throw new Error('Unbounded comment changes')
  const selected = changes.slice(0, request.limit)
  let sequence = cursor.sequence
  const hydrated = []
  for (const value of selected) {
    const change = row(value)
    if (change.post_id !== request.postId || typeof change.comment_id !== 'string' || !change.comment_id
      || typeof change.sequence !== 'number' || !Number.isSafeInteger(change.sequence) || change.sequence !== sequence + 1
      || (change.type !== 'created' && change.type !== 'deleted')) throw new Error('Invalid comment change stream')
    sequence = change.sequence
    const found = await store.comment(change.comment_id)
    hydrated.push({ comment_id: change.comment_id, sequence, type: change.type, comment: found === null ? null : projectComment(found, viewer) })
  }
  const payload = { changes: hydrated, next_cursor: { version: 1, post_id: request.postId, sequence }, has_more: changes.length > request.limit }
  parseCommentSyncPage(payload, cursor)
  return payload
}
