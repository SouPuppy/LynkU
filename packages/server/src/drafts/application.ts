import { parseDraft, parseDraftSave, parseDraftId, type Draft } from '@lynku/contracts'
export class DraftFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'DRAFT_CONFLICT' | 'CONFLICT' | 'DRAFT_LIMIT_REACHED') { super(code) }
}
export interface DraftTransaction {
  draft(id: string): Promise<unknown | null>
  counter(owner: string): Promise<unknown | null>
  putDraft(id: string, data: Record<string, unknown>): Promise<void>
  putCounter(owner: string, count: number): Promise<void>
  removeDraft(id: string): Promise<void>
}
export interface DraftStore {
  run<T>(operation: (transaction: DraftTransaction) => Promise<T>): Promise<T>
  list(owner: string, take: number): Promise<unknown[]>
  authorizeSave(): Promise<void>
  identifier(...parts: string[]): string
  now(): string
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored draft')
  return value as Record<string, unknown>
}
function owned(value: unknown, owner: string): Record<string, unknown> {
  const row = record(value)
  if (row._openid !== owner) throw new DraftFailure('FORBIDDEN')
  return row
}
function view(row: Record<string, unknown>): Draft {
  const time = (value: unknown) => value instanceof Date ? value.toISOString() : value
  return parseDraft({ ...row, created_at: time(row.created_at), updated_at: time(row.updated_at) })
}
function count(value: unknown, owner: string): number {
  if (value === null) return 0
  const row = owned(value, owner)
  if (typeof row.count !== 'number' || !Number.isSafeInteger(row.count) || row.count < 0 || row.count > 50) throw new Error('Invalid draft counter')
  return row.count
}
export async function saveUserDraft(store: DraftStore, owner: string, input: unknown): Promise<{ draft: Draft; status?: 'created' | 'duplicate' }> {
  let request
  try { request = parseDraftSave(input) } catch (_) { throw new DraftFailure('INVALID_INPUT') }
  await store.authorizeSave()
  const id = request.draft_id || store.identifier('draft:create', owner, request.request_id!)
  const fingerprint = store.identifier('draft:payload', request.title, request.content, request.category_id, String(request.anonymous))
  const now = store.now()
  return store.run(async transaction => {
    const value = await transaction.draft(id)
    if (value !== null && record(value)._id !== id) throw new Error('Draft ID mismatch')
    if (request.draft_id) {
      if (value === null) throw new DraftFailure('NOT_FOUND')
      const row = owned(value, owner)
      const previous = view(row)
      if (previous.revision !== request.expected_revision) throw new DraftFailure('DRAFT_CONFLICT')
      const next = { ...row, title: request.title, content: request.content, category_id: request.category_id,
        anonymous: request.anonymous, updated_at: now, revision: previous.revision + 1 }
      const draft = view(next)
      await transaction.putDraft(id, next)
      return { draft }
    }
    if (value !== null) {
      const row = owned(value, owner)
      if (row.request_fingerprint !== fingerprint) throw new DraftFailure('CONFLICT')
      return { draft: view(row), status: 'duplicate' }
    }
    const current = count(await transaction.counter(owner), owner)
    if (current >= 50) throw new DraftFailure('DRAFT_LIMIT_REACHED')
    const row = { _id: id, _openid: owner, title: request.title, content: request.content, category_id: request.category_id,
      anonymous: request.anonymous, created_at: now, updated_at: now, revision: 1,
      request_id: request.request_id, request_fingerprint: fingerprint }
    const draft = view(row)
    await transaction.putDraft(id, row)
    await transaction.putCounter(owner, current + 1)
    return { draft, status: 'created' }
  })
}
export async function listUserDrafts(store: DraftStore, owner: string): Promise<Draft[]> {
  const rows = await store.list(owner, 51)
  if (rows.length > 50) throw new Error('Draft limit invariant violated')
  return rows.map(row => view(owned(row, owner)))
}
export async function deleteUserDraft(store: DraftStore, owner: string, input: unknown, expectedRevision?: unknown): Promise<void> {
  let id
  try { id = parseDraftId(input) } catch (_) { throw new DraftFailure('INVALID_INPUT') }
  if (expectedRevision !== undefined && (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 1)) throw new DraftFailure('INVALID_INPUT')
  await store.run(async transaction => {
    const row = await transaction.draft(id)
    if (row === null) return
    if (record(row)._id !== id) throw new Error('Draft ID mismatch')
    owned(row, owner)
    if (expectedRevision !== undefined && record(row).revision !== expectedRevision) throw new DraftFailure('DRAFT_CONFLICT')
    const current = count(await transaction.counter(owner), owner)
    if (current < 1) throw new Error('Invalid draft counter')
    await transaction.removeDraft(id)
    await transaction.putCounter(owner, current - 1)
  })
}
