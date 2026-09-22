import { parseOperationRetry, type OperationRetryReceipt, type OperationKind } from '@lynku/contracts'
export class OutboxRetryFailure extends Error { constructor(readonly code: 'INVALID_INPUT' | 'CONFLICT' | 'NOT_FOUND') { super(code) } }
type Row = Record<string, unknown>
export interface OutboxRetryTransaction {
  authorize(): Promise<void>
  receipt(requestId: string): Promise<{ fingerprint: string; result: OperationRetryReceipt } | null>
  read(kind: OperationKind, id: string): Promise<Row | null>
  sourceValid(kind: OperationKind, task: Row): Promise<boolean>
  update(kind: OperationKind, id: string, fields: { status: 'pending'; next_attempt_at: number; lease_until: null; retry_revision: number }): Promise<void>
  record(requestId: string, fingerprint: string, receipt: OperationRetryReceipt, reason: string): Promise<void>
}
/** Only schedules the existing idempotent consumer; never invokes arbitrary commands or sends a payload. */
export async function scheduleOutboxRetry(store: { now(): number; run<T>(work: (tx: OutboxRetryTransaction) => Promise<T>): Promise<T> }, input: unknown): Promise<OperationRetryReceipt> {
  let request
  try { request = parseOperationRetry(input) } catch { throw new OutboxRetryFailure('INVALID_INPUT') }
  const fingerprint = JSON.stringify([request.kind, request.id, request.expectedAttempts, request.expectedRetryRevision, request.expectedStatus, request.reason])
  return store.run(async tx => {
    await tx.authorize()
    const prior = await tx.receipt(request.requestId)
    if (prior) { if (prior.fingerprint !== fingerprint) throw new OutboxRetryFailure('CONFLICT'); return prior.result }
    const task = await tx.read(request.kind, request.id)
    if (!task || task._id !== request.id) throw new OutboxRetryFailure('NOT_FOUND')
    const revision = task.retry_revision ?? 0, now = store.now()
    if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid retry clock')
    if (task.status !== request.expectedStatus || task.attempt_count !== request.expectedAttempts || revision !== request.expectedRetryRevision
      || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER) throw new OutboxRetryFailure('CONFLICT')
    if (task.status === 'pending' ? task.last_error !== 'DELIVERY_FAILED' || request.expectedAttempts < 1
      : typeof task.lease_until !== 'number' || !Number.isSafeInteger(task.lease_until) || task.lease_until > now) throw new OutboxRetryFailure('CONFLICT')
    if (!await tx.sourceValid(request.kind, task)) throw new OutboxRetryFailure('CONFLICT')
    const receipt = { kind: request.kind, id: request.id, retryRevision: revision + 1, scheduledAt: new Date(now).toISOString(), requestId: request.requestId }
    await tx.update(request.kind, request.id, { status: 'pending', next_attempt_at: now, lease_until: null, retry_revision: receipt.retryRevision })
    await tx.record(request.requestId, fingerprint, receipt, request.reason)
    return receipt
  })
}
