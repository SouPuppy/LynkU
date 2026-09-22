import { parseCaseDetail, parseCaseId, parseCloseCaseRequest, type CaseDetail } from '@lynku/contracts'
export class CaseManagementFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN') { super(code) }
}
export function projectCaseDetail(value: unknown): CaseDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid stored case')
  const row = value as Record<string, unknown>
  return parseCaseDetail({ id: row._id, targetType: row.targetType, targetId: row.targetId, reasonCode: row.reasonCode, statement: row.statement,
    status: row.status, version: row.caseVersion, createdAt: row.createdAt, resolution: row.status === 'open' ? '' : row.resolution, outcome: row.status === 'open' ? null : row.outcome, ...(row.appeal === undefined ? {} : { appeal: row.appeal }) })
}
export async function readCaseDetail(store: { read(id: string): Promise<unknown | null> }, input: unknown) {
  let id: string
  try { id = parseCaseId(input) } catch { throw new CaseManagementFailure('INVALID_INPUT') }
  const value = await store.read(id)
  if (value === null) throw new CaseManagementFailure('NOT_FOUND')
  const result = projectCaseDetail(value)
  if (result.id !== id) throw Error('Case identity mismatch')
  return result
}
export async function readOwnReport(store: { read(id: string): Promise<unknown | null> }, accountId: string, input: unknown) {
  let id: string
  try { id = parseCaseId(input) } catch { throw new CaseManagementFailure('INVALID_INPUT') }
  const value = await store.read(id)
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).reporterAccountId !== accountId) throw new CaseManagementFailure('NOT_FOUND')
  const result = projectCaseDetail(value)
  if (result.id !== id) throw Error('Report identity mismatch')
  return { reportId: result.id, status: result.status, version: result.version, outcome: result.outcome, resolution: result.resolution }
}
export interface CaseDecisionTransaction {
  authorize(): Promise<void>
  read(id: string): Promise<unknown | null>
  receipt(requestId: string): Promise<{ fingerprint: string; result: CaseDetail } | null>
  hidePost(id: string, expectedRevision: number, caseId: string, at: string): Promise<void>
  removeComment(id: string, expectedToken: string, caseId: string, at: string): Promise<void>
  update(id: string, fields: { status: 'closed'; caseVersion: number; outcome: 'no_violation' | 'duplicate' | 'hide_post' | 'remove_comment'; resolution: string; updatedAt: string }): Promise<void>
  record(requestId: string, fingerprint: string, result: CaseDetail, at: string): Promise<void>
}
export async function closeCase(store: { now(): string; run<T>(work: (tx: CaseDecisionTransaction) => Promise<T>): Promise<T> }, input: unknown) {
  let request
  try { request = parseCloseCaseRequest(input) } catch { throw new CaseManagementFailure('INVALID_INPUT') }
  const fingerprint = JSON.stringify([request.id, request.expectedVersion, request.outcome, request.reason, request.targetRevision ?? null, request.targetToken ?? null])
  const at = store.now()
  if (!Number.isFinite(Date.parse(at))) throw Error('Invalid decision clock')
  return store.run(async tx => {
    await tx.authorize()
    const previous = await tx.receipt(request.requestId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new CaseManagementFailure('CONFLICT')
      return parseCaseDetail(previous.result)
    }
    const current = await readCaseDetail(tx, { id: request.id })
    if (current.status !== 'open' || current.version !== request.expectedVersion || current.version >= Number.MAX_SAFE_INTEGER) throw new CaseManagementFailure('CONFLICT')
    if (request.outcome === 'hide_post') {
      if (current.targetType !== 'post' || request.targetRevision === undefined) throw new CaseManagementFailure('INVALID_INPUT')
      await tx.hidePost(current.targetId, request.targetRevision, current.id, at)
    }
    if (request.outcome === 'remove_comment') {
      if (current.targetType !== 'comment' || !request.targetToken) throw new CaseManagementFailure('INVALID_INPUT')
      await tx.removeComment(current.targetId, request.targetToken, current.id, at)
    }
    const result = parseCaseDetail({ ...current, status: 'closed', version: current.version + 1, outcome: request.outcome, resolution: request.reason })
    await tx.update(current.id, { status: 'closed', caseVersion: result.version, outcome: request.outcome, resolution: request.reason, updatedAt: at })
    await tx.record(request.requestId, fingerprint, result, at)
    return result
  })
}
