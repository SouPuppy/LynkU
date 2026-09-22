import { parseCategoryCreation, type ManagedCategory, type CategoryChangeReceipt } from '@lynku/contracts'
import { categoryNameAllowed } from './categories'
import { CategoryChangeFailure } from './manage-category'
export interface CategoryCreationTransaction {
  authorize(): Promise<void>
  receipt(requestId: string): Promise<{ fingerprint: string; result: CategoryChangeReceipt } | null>
  count(): Promise<number>
  exists(id: string): Promise<boolean>
  create(category: ManagedCategory): Promise<void>
  incrementCount(expected: number): Promise<void>
  record(requestId: string, fingerprint: string, result: CategoryChangeReceipt, reason: string): Promise<void>
}
export async function createManagedCategory(store: { now(): string; identifier(requestId: string): string; run<T>(work: (tx: CategoryCreationTransaction) => Promise<T>): Promise<T> }, input: unknown): Promise<CategoryChangeReceipt> {
  let request
  try { request = parseCategoryCreation(input) } catch { throw new CategoryChangeFailure('INVALID_INPUT') }
  if (!categoryNameAllowed(request.name)) throw new CategoryChangeFailure('INVALID_CATEGORY')
  const fingerprint = JSON.stringify([request.name, request.description, request.sort_order, request.status, request.reason])
  return store.run(async tx => {
    await tx.authorize()
    const prior = await tx.receipt(request.requestId)
    if (prior) { if (prior.fingerprint !== fingerprint) throw new CategoryChangeFailure('CONFLICT'); return prior.result }
    const count = await tx.count()
    if (!Number.isSafeInteger(count) || count < 0) throw Error('Category catalog is not initialized')
    if (count >= 100) throw new CategoryChangeFailure('CONFLICT')
    const id = store.identifier(request.requestId)
    if (await tx.exists(id)) throw new CategoryChangeFailure('CONFLICT')
    const category: ManagedCategory = { _id: id, name: request.name, description: request.description, sort_order: request.sort_order, status: request.status, post_count: 0, managementRevision: 1 }
    const appliedAt = store.now()
    if (!Number.isFinite(Date.parse(appliedAt))) throw Error('Invalid category creation clock')
    const result = { requestId: request.requestId, category, appliedAt }
    await tx.create(category)
    await tx.incrementCount(count)
    await tx.record(request.requestId, fingerprint, result, request.reason)
    return result
  })
}
