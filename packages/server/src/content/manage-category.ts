import { parseCategoryChange, parseManagedCategory, type ManagedCategory, type CategoryChangeReceipt } from '@lynku/contracts'
import { categoryNameAllowed } from './categories'

export class CategoryChangeFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'INVALID_CATEGORY' | 'NOT_FOUND' | 'CONFLICT') { super(code) }
}
export interface CategoryChangeTransaction {
  /** Must participate in this transaction's read set, including revocation and account state. */
  authorize(): Promise<void>
  read(id: string): Promise<unknown | null>
  receipt(requestId: string): Promise<{ fingerprint: string; result: CategoryChangeReceipt } | null>
  update(id: string, fields: Pick<ManagedCategory, 'name' | 'description' | 'status' | 'sort_order' | 'managementRevision'>): Promise<void>
  record(requestId: string, fingerprint: string, result: CategoryChangeReceipt, reason: string): Promise<void>
}
export interface CategoryChangeStore {
  now(): string
  run<T>(work: (transaction: CategoryChangeTransaction) => Promise<T>): Promise<T>
}
/** Content owns category edits; the workflow supplies atomic authorization, audit and actor-scoped receipts. */
export async function changeManagedCategory(store: CategoryChangeStore, input: unknown): Promise<CategoryChangeReceipt> {
  let request
  try { request = parseCategoryChange(input) } catch { throw new CategoryChangeFailure('INVALID_INPUT') }
  if (!categoryNameAllowed(request.category.name)) throw new CategoryChangeFailure('INVALID_CATEGORY')
  const { _id: id, name, description, sort_order, status, managementRevision } = request.category
  const fingerprint = JSON.stringify([id, name, description, sort_order, status, managementRevision, request.reason])
  const appliedAt = store.now()
  if (!Number.isFinite(Date.parse(appliedAt))) throw Error('Invalid category change clock')
  return store.run(async tx => {
    await tx.authorize()
    const previous = await tx.receipt(request.requestId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new CategoryChangeFailure('CONFLICT')
      return previous.result
    }
    const value = await tx.read(id)
    if (value === null) throw new CategoryChangeFailure('NOT_FOUND')
    const current = parseManagedCategory(value)
    if (current._id !== id) throw Error('Category identity mismatch')
    if (current.managementRevision !== managementRevision || managementRevision >= Number.MAX_SAFE_INTEGER) throw new CategoryChangeFailure('CONFLICT')
    const fields = { name, description, sort_order, status, managementRevision: managementRevision + 1 }
    const result = { requestId: request.requestId, category: { ...current, ...fields }, appliedAt }
    await tx.update(id, fields)
    await tx.record(request.requestId, fingerprint, result, request.reason)
    return result
  })
}
