import { parseRestoreGovernedPostReceipt, parseRestoreGovernedPostRequest, type RestoreGovernedPostReceipt } from '@lynku/contracts'
import { ModerationFailure } from '../shared'

export class RestoreGovernedPostFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_CATEGORY') { super(code) }
}

type Post = { id: string; owner: string; title: string; content: string; categoryId: string; revision: number }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid governed post')
  return value as Record<string, unknown>
}
function hiddenPost(value: unknown, id: string, caseId: string, expectedRevision: number): Post {
  if (value === null) throw new RestoreGovernedPostFailure('NOT_FOUND')
  const row = record(value)
  if (row._id !== id) throw Error('Post identity mismatch')
  if (row.status !== 'hidden' || row.governance_case_id !== caseId || row.revision !== expectedRevision) throw new RestoreGovernedPostFailure('CONFLICT')
  if (typeof row._openid !== 'string' || !row._openid || typeof row.title !== 'string' || !row.title || row.title.length > 200
    || typeof row.content !== 'string' || !row.content || row.content.length > 10000 || typeof row.category_id !== 'string'
    || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER) throw Error('Invalid hidden post')
  return { id, owner: row._openid, title: row.title, content: row.content, categoryId: row.category_id, revision: row.revision }
}

export interface RestoreGovernedPostTransaction {
  authorize(): Promise<void>
  post(id: string): Promise<unknown | null>
  category(id: string): Promise<unknown | null>
  case(id: string): Promise<unknown | null>
  receipt(requestId: string): Promise<{ fingerprint: string; result: RestoreGovernedPostReceipt } | null>
  updatePost(id: string, fields: { status: 'published'; revision: number; updated_at: string }): Promise<void>
  setCategoryCount(id: string, count: number): Promise<void>
  record(requestId: string, fingerprint: string, result: RestoreGovernedPostReceipt, reason: string): Promise<void>
}

/** A restoration only makes the exact, previously hidden body visible again. It never edits or approves replacement content. */
export async function restoreGovernedPost(store: {
  now(): string
  inspect(id: string): Promise<unknown | null>
  prior(requestId: string): Promise<{ fingerprint: string; result: RestoreGovernedPostReceipt } | null>
  moderate(owner: string, content: string): Promise<{ clean: boolean }>
  run<T>(work: (tx: RestoreGovernedPostTransaction) => Promise<T>): Promise<T>
}, input: unknown): Promise<RestoreGovernedPostReceipt> {
  let request
  try { request = parseRestoreGovernedPostRequest(input) } catch { throw new RestoreGovernedPostFailure('INVALID_INPUT') }
  const fingerprint = JSON.stringify([request.postId, request.caseId, request.expectedRevision, request.reason])
  const prior = await store.prior(request.requestId)
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new RestoreGovernedPostFailure('CONFLICT')
    return parseRestoreGovernedPostReceipt(prior.result)
  }
  const inspected = hiddenPost(await store.inspect(request.postId), request.postId, request.caseId, request.expectedRevision)
  const verdict = await store.moderate(inspected.owner, `${inspected.title} ${inspected.content}`)
  if (verdict?.clean !== true) throw new ModerationFailure(verdict?.clean === false ? 'CONTENT_REJECTED' : 'MODERATION_UNAVAILABLE')
  const at = store.now()
  if (!Number.isFinite(Date.parse(at))) throw Error('Invalid restoration clock')
  return store.run(async tx => {
    await tx.authorize()
    const previous = await tx.receipt(request.requestId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new RestoreGovernedPostFailure('CONFLICT')
      return parseRestoreGovernedPostReceipt(previous.result)
    }
    const post = hiddenPost(await tx.post(request.postId), request.postId, request.caseId, request.expectedRevision)
    const sourceCase = await tx.case(request.caseId)
    if (!sourceCase || typeof sourceCase !== 'object' || Array.isArray(sourceCase)) throw new RestoreGovernedPostFailure('CONFLICT')
    const decision = sourceCase as Record<string, unknown>
    if (decision._id !== request.caseId || decision.targetType !== 'post' || decision.targetId !== request.postId
      || decision.status !== 'closed' || decision.outcome !== 'hide_post') throw new RestoreGovernedPostFailure('CONFLICT')
    let categoryCount: number | null = null
    if (post.categoryId) {
      const value = await tx.category(post.categoryId)
      if (value === null) throw new RestoreGovernedPostFailure('INVALID_CATEGORY')
      const category = record(value)
      if (category._id !== post.categoryId || (category.status !== 'active' && category.status !== 'hidden')
        || typeof category.post_count !== 'number' || !Number.isSafeInteger(category.post_count) || category.post_count < 0 || category.post_count >= Number.MAX_SAFE_INTEGER) throw new RestoreGovernedPostFailure('INVALID_CATEGORY')
      categoryCount = category.post_count + 1
    }
    const result = parseRestoreGovernedPostReceipt({ requestId: request.requestId, post: { id: post.id, revision: post.revision + 1, status: 'published' }, appliedAt: at })
    await tx.updatePost(post.id, { status: 'published', revision: result.post.revision, updated_at: at })
    if (categoryCount !== null) await tx.setCategoryCount(post.categoryId, categoryCount)
    await tx.record(request.requestId, fingerprint, result, request.reason)
    return result
  })
}
