export type CaseOutcome = 'no_violation' | 'duplicate' | 'hide_post' | 'remove_comment'
export interface CaseAppeal { statement: string; submittedAt: string; previousVersion: number; previousOutcome: CaseOutcome; previousResolution: string }
export interface CaseDetail { id: string; targetType: 'post' | 'comment'; targetId: string; reasonCode: string; statement: string; status: 'open' | 'closed'; version: number; createdAt: string; resolution: string; outcome: CaseOutcome | null; appeal?: CaseAppeal }
export interface CloseCaseRequest { requestId: string; id: string; expectedVersion: number; outcome: CaseOutcome; reason: string; targetRevision?: number; targetToken?: string }
function row(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid case payload'); return value as Record<string, unknown> }
function text(value: unknown, max: number, empty = false): string { if (typeof value !== 'string' || !empty && !value.trim() || value.length > max) throw Error('Invalid case field'); return value }
export function parseCaseId(value: unknown): string { return text(row(value).id, 128) }
export function parseCaseDetail(value: unknown): CaseDetail {
  const valueRow = row(value)
  if (valueRow.targetType !== 'post' && valueRow.targetType !== 'comment' || valueRow.status !== 'open' && valueRow.status !== 'closed'
    || typeof valueRow.version !== 'number' || !Number.isSafeInteger(valueRow.version) || valueRow.version < 1
    || valueRow.outcome !== null && valueRow.outcome !== 'no_violation' && valueRow.outcome !== 'duplicate' && valueRow.outcome !== 'hide_post' && valueRow.outcome !== 'remove_comment') throw Error('Invalid case state')
  const createdAt = text(valueRow.createdAt, 30)
  if (!Number.isFinite(Date.parse(createdAt))) throw Error('Invalid case date')
  if (valueRow.status === 'open' && valueRow.outcome !== null || valueRow.status === 'closed' && valueRow.outcome === null) throw Error('Invalid case decision')
  return { id: text(valueRow.id, 128), targetType: valueRow.targetType, targetId: text(valueRow.targetId, 128), reasonCode: text(valueRow.reasonCode, 48),
    statement: text(valueRow.statement, 1000, true), status: valueRow.status, version: valueRow.version, createdAt,
    resolution: text(valueRow.resolution, 1000, valueRow.status === 'open'), outcome: valueRow.outcome, ...(valueRow.appeal === undefined ? {} : { appeal: parseCaseAppeal(valueRow.appeal) }) }
}
function parseCaseAppeal(value: unknown): CaseAppeal {
  const input = row(value), submittedAt = text(input.submittedAt, 30)
  if (!Number.isFinite(Date.parse(submittedAt)) || typeof input.previousVersion !== 'number' || !Number.isSafeInteger(input.previousVersion) || input.previousVersion < 1
    || input.previousOutcome !== 'no_violation' && input.previousOutcome !== 'duplicate' && input.previousOutcome !== 'hide_post' && input.previousOutcome !== 'remove_comment') throw Error('Invalid appeal')
  return { statement: text(input.statement, 1000), submittedAt, previousVersion: input.previousVersion, previousOutcome: input.previousOutcome, previousResolution: text(input.previousResolution, 1000) }
}
export function parseCloseCaseRequest(value: unknown): CloseCaseRequest {
  const input = row(value)
  if (typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
    || input.outcome !== 'no_violation' && input.outcome !== 'duplicate' && input.outcome !== 'hide_post' && input.outcome !== 'remove_comment') throw Error('Invalid case decision')
  const requestId = text(input.requestId, 80)
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) throw Error('Invalid case request')
  if (input.outcome === 'hide_post' && (typeof input.targetRevision !== 'number' || !Number.isSafeInteger(input.targetRevision) || input.targetRevision < 1)
    || input.outcome !== 'hide_post' && input.targetRevision !== undefined) throw Error('Invalid target version')
  if (input.outcome === 'remove_comment' && (typeof input.targetToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.targetToken))
    || input.outcome !== 'remove_comment' && input.targetToken !== undefined) throw Error('Invalid comment version')
  return { requestId, id: text(input.id, 128), expectedVersion: input.expectedVersion, outcome: input.outcome, reason: text(input.reason, 1000).trim(),
    ...(input.outcome === 'hide_post' ? { targetRevision: input.targetRevision as number } : {}),
    ...(input.outcome === 'remove_comment' ? { targetToken: input.targetToken as string } : {}) }
}
