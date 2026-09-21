export class PostStatusFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_CATEGORY') { super(code) }
}
export interface PostStatusTransaction {
  post(id: string): Promise<unknown | null>
  category(id: string): Promise<unknown | null>
  setStatus(id: string, status: 'deleted' | 'published' | 'flagged', revision: number, updatedAt: string): Promise<void>
  setCategoryCount(id: string, count: number): Promise<void>
}
export interface PostStatusStore {
  existing(id: string): Promise<unknown | null>
  run<T>(operation: (transaction: PostStatusTransaction) => Promise<T>): Promise<T>
  now(): string
}
export interface ContentActor { id: string; isAdmin: boolean }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored content')
  return value as Record<string, unknown>
}
async function transition(store: PostStatusStore, actor: ContentActor, id: unknown,
  next: 'deleted' | 'published' | 'flagged'): Promise<void> {
  if (typeof id !== 'string' || !id || id.length > 128 || id.trim() !== id) throw new PostStatusFailure('INVALID_INPUT')
  if (next !== 'deleted' && !actor.isAdmin) throw new PostStatusFailure('FORBIDDEN')
  const inspect = (value: unknown) => {
    if (value === null) throw new PostStatusFailure('NOT_FOUND')
    const row = object(value)
    if (row._id !== id) throw new Error('Post ID mismatch')
    if (next === 'deleted' && row._openid !== actor.id && !actor.isAdmin) throw new PostStatusFailure('FORBIDDEN')
    if (row.status === 'deleted' && next !== 'deleted') throw new PostStatusFailure('NOT_FOUND')
    if (typeof row.status !== 'string' || !['published', 'flagged', 'hidden', 'deleted'].includes(row.status)) throw new Error('Invalid post status')
    return row
  }
  const prior = inspect(await store.existing(id))
  if (prior.status === next) return
  const updatedAt = store.now()
  if (!Number.isFinite(new Date(updatedAt).getTime())) throw new Error('Invalid transition clock')
  await store.run(async transaction => {
    const row = inspect(await transaction.post(id))
    if (row.status === next) return
    if (typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1
      || row.revision >= Number.MAX_SAFE_INTEGER || typeof row.category_id !== 'string') throw new Error('Invalid post version')
    const delta = Number(next === 'published') - Number(row.status === 'published')
    let categoryCount: number | null = null
    if (delta && row.category_id) {
      const value = await transaction.category(row.category_id)
      if (value === null) throw new PostStatusFailure('INVALID_CATEGORY')
      const category = object(value)
      if (category._id !== row.category_id || (next === 'published' && category.status !== 'active')) throw new PostStatusFailure('INVALID_CATEGORY')
      if (typeof category.post_count !== 'number' || !Number.isSafeInteger(category.post_count) || category.post_count < 0) throw new Error('Invalid category count')
      categoryCount = category.post_count + delta
      if (!Number.isSafeInteger(categoryCount) || categoryCount < 0) throw new Error('Invalid category count')
    }
    await transaction.setStatus(id, next, row.revision + 1, updatedAt)
    if (categoryCount !== null) await transaction.setCategoryCount(row.category_id, categoryCount)
  })
}
export function deleteUserPost(store: PostStatusStore, actor: ContentActor, id: unknown): Promise<void> {
  return transition(store, actor, id, 'deleted')
}
export async function moderatePost(store: PostStatusStore, actor: ContentActor, id: unknown, flagged: unknown): Promise<void> {
  if (typeof flagged !== 'boolean') throw new PostStatusFailure('INVALID_INPUT')
  await transition(store, actor, id, flagged ? 'flagged' : 'published')
}
