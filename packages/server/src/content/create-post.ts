import { ANONYMOUS_AVATAR } from '@lynku/contracts'
import { parseCreatePostRequest, parsePostMutationReceipt, type PostMutationReceipt } from '@lynku/contracts'
import { categoryNameAllowed } from './categories'
import { currentPostAuthor } from './post-author'
import { assertAccountCapability } from '../shared'
import { ModerationFailure } from '../shared'
export class PostCreateFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'INVALID_CATEGORY' | 'CONFLICT') { super(code) }
}
export interface PostCreateTransaction {
  author(): Promise<unknown | null>
  post(id: string): Promise<unknown | null>
  category(id: string): Promise<unknown | null>
  putPost(id: string, data: Record<string, unknown>): Promise<void>
  setCategoryCount(id: string, count: number): Promise<void>
}
export interface PostCreateStore {
  existing(id: string): Promise<unknown | null>
  run<T>(operation: (transaction: PostCreateTransaction) => Promise<T>): Promise<T>
  identifier(...parts: string[]): string
  allowCreate(): Promise<void>
  moderate(text: string): Promise<{ clean: boolean }>
  now(): string
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored post record')
  return value as Record<string, unknown>
}
export async function createUserPost(store: PostCreateStore, owner: string, input: unknown): Promise<PostMutationReceipt> {
  let request
  try { request = parseCreatePostRequest(input) } catch (_) { throw new PostCreateFailure('INVALID_INPUT') }
  const id = store.identifier('post:create', owner, request.request_id)
  const fingerprint = store.identifier('post:payload', request.title, request.content, request.category_id, String(request.anonymous))
  const receipt = (existing: unknown): PostMutationReceipt => {
    const row = record(existing)
    if (row._id !== id || row._openid !== owner || row.request_fingerprint !== fingerprint) throw new PostCreateFailure('CONFLICT')
    return parsePostMutationReceipt({ post: row, flagged: row.status === 'flagged', status: 'duplicate' }, 'create')
  }
  const prior = await store.existing(id)
  if (prior !== null) return receipt(prior)
  await store.allowCreate()
  const verdict = await store.moderate(`${request.title} ${request.content}`)
  if (verdict?.clean !== true) throw new ModerationFailure(verdict?.clean === false ? 'CONTENT_REJECTED' : 'MODERATION_UNAVAILABLE')
  const status = 'published'
  const timestamp = store.now()
  if (!Number.isFinite(new Date(timestamp).getTime())) throw new Error('Invalid creation clock')
  return store.run(async transaction => {
    const account = await transaction.author()
    assertAccountCapability(account, 'posts', store.now())
    const author = currentPostAuthor(account, owner)
    const existing = await transaction.post(id)
    if (existing !== null) {
      return receipt(existing)
    }
    let category: { _id: string; name: string } | null = null
    let categoryCount = 0
    if (request.category_id) {
      const value = await transaction.category(request.category_id)
      if (value === null) throw new PostCreateFailure('INVALID_CATEGORY')
      const row = record(value)
      if (row._id !== request.category_id || row.status !== 'active' || typeof row.name !== 'string' || !categoryNameAllowed(row.name)) throw new PostCreateFailure('INVALID_CATEGORY')
      if (typeof row.name !== 'string' || !row.name || row.name.length > 100
        || typeof row.post_count !== 'number' || !Number.isSafeInteger(row.post_count) || row.post_count < 0
        || row.post_count >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid category record')
      category = { _id: request.category_id, name: row.name }
      categoryCount = row.post_count
    }
    const post = { _id: id, _openid: owner, title: request.title, content: request.content,
      category_id: request.category_id, category, anonymous: request.anonymous, status, revision: 1,
      author: { _openid: owner, nickname: request.anonymous ? '匿名用户' : author.nickname,
        avatar_url: request.anonymous ? ANONYMOUS_AVATAR : author.avatar_url, profile_version: author.profile_version },
      view_count: 0, comment_count: 0, created_at: timestamp, updated_at: timestamp,
      request_id: request.request_id, request_fingerprint: fingerprint }
    await transaction.putPost(id, post)
    if (category && status === 'published') await transaction.setCategoryCount(category._id, categoryCount + 1)
    return parsePostMutationReceipt({ post, flagged: false, status: 'created' }, 'create')
  })
}
