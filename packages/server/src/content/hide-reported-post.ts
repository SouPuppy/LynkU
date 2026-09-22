export class PostGovernanceFailure extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_CATEGORY') { super(code) }
}
export interface PostHideTransaction {
  post(id: string): Promise<unknown | null>
  category(id: string): Promise<unknown | null>
  updatePost(id: string, fields: { status: 'hidden'; revision: number; updated_at: string; governance_case_id: string }): Promise<void>
  setCategoryCount(id: string, count: number): Promise<void>
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid governed content'); return value as Record<string, unknown> }
/** Called within the same transaction as the case decision; never restores or republishes content. */
export async function hideReportedPost(tx: PostHideTransaction, id: string, expectedRevision: number, caseId: string, at: string) {
  const value = await tx.post(id)
  if (value === null) throw new PostGovernanceFailure('NOT_FOUND')
  const post = record(value)
  if (post._id !== id) throw Error('Post identity mismatch')
  if (post.status !== 'published' || post.revision !== expectedRevision || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new PostGovernanceFailure('CONFLICT')
  if (typeof post.category_id !== 'string') throw Error('Invalid post category')
  let count: number | null = null
  if (post.category_id) {
    const value = await tx.category(post.category_id)
    if (value === null) throw new PostGovernanceFailure('INVALID_CATEGORY')
    const category = record(value)
    if (category._id !== post.category_id || typeof category.post_count !== 'number' || !Number.isSafeInteger(category.post_count) || category.post_count < 1) throw Error('Invalid category count')
    count = category.post_count - 1
  }
  await tx.updatePost(id, { status: 'hidden', revision: expectedRevision + 1, updated_at: at, governance_case_id: caseId })
  if (count !== null) await tx.setCategoryCount(post.category_id, count)
}
