export type OperationKind = 'notifications' | 'profiles'
export type OperationStatus = 'pending' | 'processing' | 'delivered'
export interface OperationTask { id: string; kind: OperationKind; status: OperationStatus; createdAt: string; attempts: number; retryRevision: number; nextAttemptAt: number | null; leaseUntil: number | null; lastAttemptAt: number | null; deliveredAt: string | null; lastError: 'DELIVERY_FAILED' | 'UNCLASSIFIED_ERROR' | null }
export interface OperationCursor { id: string; createdAt: string; scope: string }
export interface OperationQuery { kind: OperationKind; status: OperationStatus | 'all'; cursor: OperationCursor | null; limit: number }
export interface OperationPage { items: OperationTask[]; nextCursor: OperationCursor | null }
function row(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid operation object'); return value as Record<string, unknown> }
function text(value: unknown, max = 128): string { if (typeof value !== 'string' || !value || value.length > max || value.trim() !== value) throw Error('Invalid operation text'); return value }
function date(value: unknown): string { const result = text(value, 24); if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw Error('Invalid operation date'); return result }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('Invalid operation integer'); return value }
export function operationKind(value: unknown): OperationKind { if (value !== 'notifications' && value !== 'profiles') throw Error('Invalid operation kind'); return value }
function status(value: unknown): OperationStatus { if (value !== 'pending' && value !== 'processing' && value !== 'delivered') throw Error('Invalid operation status'); return value }
export function operationScope(query: Pick<OperationQuery, 'kind' | 'status'>): string { return JSON.stringify(['admin-operations:1', query.kind, query.status]) }
function cursor(value: unknown): OperationCursor { const input = row(value); return { id: text(input.id), createdAt: date(input.createdAt), scope: text(input.scope, 256) } }
export function parseOperationQuery(value: unknown): OperationQuery {
  const input = row(value), limit = integer(input.limit ?? 25)
  if (limit < 1 || limit > 50 || input.offset !== undefined) throw Error('Invalid operation limit')
  const query: OperationQuery = { kind: operationKind(input.kind ?? 'notifications'), status: input.status === 'all' ? 'all' : status(input.status ?? 'pending'), limit, cursor: input.cursor == null ? null : cursor(input.cursor) }
  if (query.cursor && query.cursor.scope !== operationScope(query)) throw Error('Operation cursor scope mismatch')
  return query
}
export function parseOperationTask(value: unknown): OperationTask {
  const input = row(value)
  if (input.lastError !== null && input.lastError !== 'DELIVERY_FAILED' && input.lastError !== 'UNCLASSIFIED_ERROR') throw Error('Invalid operation error')
  const task: OperationTask = { id: text(input.id), kind: operationKind(input.kind), status: status(input.status), createdAt: date(input.createdAt), attempts: integer(input.attempts),
    retryRevision: integer(input.retryRevision),
    nextAttemptAt: input.nextAttemptAt === null ? null : integer(input.nextAttemptAt), leaseUntil: input.leaseUntil === null ? null : integer(input.leaseUntil),
    lastAttemptAt: input.lastAttemptAt === null ? null : integer(input.lastAttemptAt), deliveredAt: input.deliveredAt === null ? null : date(input.deliveredAt), lastError: input.lastError }
  if (task.status === 'pending' && task.nextAttemptAt === null || task.status === 'processing' && task.leaseUntil === null || task.status === 'delivered' && task.deliveredAt === null) throw Error('Missing operation timing')
  return task
}
export interface OperationRetry { kind: OperationKind; id: string; expectedAttempts: number; expectedRetryRevision: number; expectedStatus: 'pending' | 'processing'; requestId: string; reason: string }
export interface OperationRetryReceipt { kind: OperationKind; id: string; retryRevision: number; scheduledAt: string; requestId: string }
export function parseOperationRetry(value: unknown): OperationRetry {
  const input = row(value), requestId = text(input.requestId, 80), reason = text(input.reason, 500)
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId) || input.expectedStatus !== 'pending' && input.expectedStatus !== 'processing') throw Error('Invalid retry request')
  return { kind: operationKind(input.kind), id: text(input.id), expectedAttempts: integer(input.expectedAttempts), expectedRetryRevision: integer(input.expectedRetryRevision), expectedStatus: input.expectedStatus, requestId, reason }
}
export function parseOperationRetryReceipt(value: unknown): OperationRetryReceipt {
  const input = row(value)
  return { kind: operationKind(input.kind), id: text(input.id), retryRevision: integer(input.retryRevision), scheduledAt: date(input.scheduledAt), requestId: text(input.requestId, 80) }
}
export function operationPrecedes(before: { id: string; createdAt: string }, after: { id: string; createdAt: string }): boolean { return before.createdAt > after.createdAt || before.createdAt === after.createdAt && before.id > after.id }
export function parseOperationPage(value: unknown): OperationPage {
  const input = row(value)
  if (!Array.isArray(input.items) || input.items.length > 50) throw Error('Invalid operation page')
  const items = input.items.map(parseOperationTask), nextCursor = input.nextCursor === null ? null : cursor(input.nextCursor), last = items[items.length - 1]
  if (items.some((item, index) => index > 0 && !operationPrecedes(items[index - 1]!, item)) || nextCursor && (!last || last.id !== nextCursor.id || last.createdAt !== nextCursor.createdAt)) throw Error('Invalid operation ordering')
  return { items, nextCursor }
}
