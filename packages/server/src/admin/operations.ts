import { operationKind, operationPrecedes, operationScope, parseOperationQuery, parseOperationPage, parseOperationTask,
  type OperationKind, type OperationTask, type OperationQuery, type OperationPage } from '@lynku/contracts'
export class AdminOperationFailure extends Error { constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND') { super(code) } }
export function projectOperationTask(value: unknown, kind: OperationKind): OperationTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid stored operation')
  const source = value as Record<string, unknown>
  const date = (value: unknown) => value instanceof Date ? value.toISOString() : value
  return parseOperationTask({ id: source._id, kind, status: source.status, createdAt: date(source.created_at), attempts: source.attempt_count,
    nextAttemptAt: source.status === 'pending' ? source.next_attempt_at : null, leaseUntil: source.status === 'processing' ? source.lease_until : null,
    lastAttemptAt: source.last_attempt_at ?? null, deliveredAt: source.delivered_at == null ? null : date(source.delivered_at),
    lastError: source.last_error == null ? null : source.last_error === 'DELIVERY_FAILED' ? 'DELIVERY_FAILED' : 'UNCLASSIFIED_ERROR' })
}
export async function readOperationTasks(store: { list(query: OperationQuery, take: number): Promise<unknown[]> }, input: unknown): Promise<OperationPage> {
  let query: OperationQuery
  try { query = parseOperationQuery(input) } catch { throw new AdminOperationFailure('INVALID_INPUT') }
  const rows = await store.list(query, query.limit + 1)
  if (rows.length > query.limit + 1) throw Error('Operation query exceeded limit')
  const tasks = rows.map(value => projectOperationTask(value, query.kind))
  tasks.forEach((task, index) => { const before = index ? tasks[index - 1] : query.cursor; if (before && !operationPrecedes(before, task) || query.status !== 'all' && task.status !== query.status) throw Error('Operation query scope mismatch') })
  const items = tasks.slice(0, query.limit), last = items[items.length - 1]
  return parseOperationPage({ items, nextCursor: tasks.length > query.limit && last ? { id: last.id, createdAt: last.createdAt, scope: operationScope(query) } : null })
}
export async function readOperationTask(store: { read(kind: OperationKind, id: string): Promise<unknown> }, input: unknown): Promise<OperationTask> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminOperationFailure('INVALID_INPUT')
  const source = input as Record<string, unknown>
  let kind: OperationKind
  try { kind = operationKind(source.kind) } catch { throw new AdminOperationFailure('INVALID_INPUT') }
  const id = source.id
  if (typeof id !== 'string' || !id || id.length > 128 || id.trim() !== id) throw new AdminOperationFailure('INVALID_INPUT')
  const task = await store.read(kind, id)
  if (!task) throw new AdminOperationFailure('NOT_FOUND')
  const result = projectOperationTask(task, kind)
  if (result.id !== id) throw Error('Operation ID mismatch')
  return result
}
