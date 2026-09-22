import { parseUpdatePostRequest, parsePostMutationReceipt, type PostMutationReceipt } from '@lynku/contracts'
import { categoryNameAllowed } from './categories'
import { currentPostAuthor } from './post-author'
import { assertAccountCapability } from '../shared'
import { ModerationFailure } from '../shared'
export class PostUpdateFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'INVALID_CATEGORY' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT') { super(code) }
}
export interface PostUpdateTransaction {
  author(): Promise<unknown | null>
  post(id: string): Promise<unknown | null>
  category(id: string): Promise<unknown | null>
  updatePost(id: string, changes: Record<string, unknown>): Promise<void>
  setCategoryCount(id: string, count: number): Promise<void>
}
export interface PostUpdateStore {
  existing(id: string): Promise<unknown | null>
  run<T>(operation: (transaction: PostUpdateTransaction) => Promise<T>): Promise<T>
  identifier(...parts: string[]): string
  allowUpdate(): Promise<void>
  moderate(text: string): Promise<{ clean: boolean }>
  now(): string
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid content record')
  return value as Record<string, unknown>
}
export async function updateUserPost(store: PostUpdateStore, owner: string, input: unknown): Promise<PostMutationReceipt> {
  let request
  try { request = parseUpdatePostRequest(input) } catch (_) { throw new PostUpdateFailure('INVALID_INPUT') }
  const fingerprint = store.identifier('post:update', owner, request.post_id, String(request.expected_revision),
    request.title, request.content, request.category_id, String(request.anonymous))
  const inspect = (value: unknown) => {
    if (value === null) throw new PostUpdateFailure('NOT_FOUND')
    const row = object(value)
    if (row._id !== request.post_id) throw new Error('Post ID mismatch')
    if (row._openid !== owner) throw new PostUpdateFailure('FORBIDDEN')
    if (row.status === 'deleted' || row.status === 'hidden') throw new PostUpdateFailure('NOT_FOUND')
    if ((row.status !== 'published' && row.status !== 'flagged') || typeof row.revision !== 'number'
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.category_id !== 'string') throw new Error('Invalid post state')
    const duplicate = row.revision === request.expected_revision + 1 && row.last_update_fingerprint === fingerprint
    if (!duplicate && row.revision !== request.expected_revision) throw new PostUpdateFailure('CONFLICT')
    return { row, duplicate }
  }
  const prior = inspect(await store.existing(request.post_id))
  if (prior.duplicate) return parsePostMutationReceipt({ post: prior.row, flagged: prior.row.status === 'flagged' }, 'update', request.post_id)
  await store.allowUpdate()
  const verdict = await store.moderate(`${request.title} ${request.content}`)
  if (verdict?.clean !== true) throw new ModerationFailure(verdict?.clean === false ? 'CONTENT_REJECTED' : 'MODERATION_UNAVAILABLE')
  const status = 'published'
  const updatedAt = store.now()
  if (!Number.isFinite(new Date(updatedAt).getTime())) throw new Error('Invalid update clock')
  return store.run(async transaction => {
    const account = await transaction.author()
    assertAccountCapability(account, 'posts', store.now())
    const author = currentPostAuthor(account, owner)
    const { row, duplicate } = inspect(await transaction.post(request.post_id))
    if (duplicate) return parsePostMutationReceipt({ post: row, flagged: row.status === 'flagged' }, 'update', request.post_id)
    const deltas = new Map<string, number>()
    if (row.status === 'published' && row.category_id) deltas.set(row.category_id as string, -1)
    if (status === 'published' && request.category_id) deltas.set(request.category_id, (deltas.get(request.category_id) || 0) + 1)
    const ids = new Set([...deltas.keys(), ...(request.category_id ? [request.category_id] : [])])
    const counts: Array<{ id: string; count: number }> = []
    let category: { _id: string; name: string } | null = null
    for (const id of ids) {
      const value = await transaction.category(id)
      if (value === null) throw new PostUpdateFailure('INVALID_CATEGORY')
      const item = object(value)
      if (item._id !== id || (id === request.category_id && (item.status !== 'active' || typeof item.name !== 'string' || !categoryNameAllowed(item.name)))) throw new PostUpdateFailure('INVALID_CATEGORY')
      if (typeof item.name !== 'string' || !item.name || typeof item.post_count !== 'number'
        || !Number.isSafeInteger(item.post_count) || item.post_count < 0) throw new Error('Invalid category record')
      const delta = deltas.get(id) || 0
      const count = item.post_count + delta
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid category count')
      if (delta) counts.push({ id, count })
      if (id === request.category_id) category = { _id: id, name: item.name }
    }
    const changes = { title: request.title, content: request.content, category_id: request.category_id, category,
      anonymous: request.anonymous, status, revision: request.expected_revision + 1, last_update_fingerprint: fingerprint,
      author: { _openid: owner, nickname: request.anonymous ? '匿名用户' : author.nickname,
        avatar_url: request.anonymous ? '/assets/anonymous.png' : author.avatar_url, profile_version: author.profile_version }, updated_at: updatedAt }
    await transaction.updatePost(request.post_id, changes)
    for (const change of counts) await transaction.setCategoryCount(change.id, change.count)
    return parsePostMutationReceipt({ post: { _id: request.post_id, ...changes }, flagged: false }, 'update', request.post_id)
  })
}
