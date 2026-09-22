import { CaseManagementFailure, projectCaseDetail } from './case-management'
export interface ReportAppealRequest { id: string; expectedVersion: number; requestId: string; statement: string }
export interface ReportAppealReceipt { reportId: string; acceptedVersion: number; requestId: string }
export function parseReportAppealRequest(value: unknown): ReportAppealRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CaseManagementFailure('INVALID_INPUT')
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id || row.id.length > 128 || typeof row.expectedVersion !== 'number' || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 1
    || typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(row.requestId)
    || typeof row.statement !== 'string' || !row.statement.trim() || row.statement.length > 1000) throw new CaseManagementFailure('INVALID_INPUT')
  return { id: row.id, expectedVersion: row.expectedVersion, requestId: row.requestId, statement: row.statement.trim() }
}
export interface AppealTransaction {
  authorize(): Promise<void>
  read(id: string): Promise<Record<string, unknown> | null>
  update(id: string, fields: Record<string, unknown>): Promise<void>
  audit(id: string, fields: Record<string, unknown>): Promise<void>
}
/** Reporter appeals return to the ordinary case work queue; they never republish content. */
export async function appealOwnReport(store: { now(): string; identifier(...parts: string[]): string; run<T>(work: (tx: AppealTransaction) => Promise<T>): Promise<T> }, accountId: string, input: unknown): Promise<ReportAppealReceipt> {
  const request = parseReportAppealRequest(input)
  const fingerprint = store.identifier('report-appeal', request.id, accountId, String(request.expectedVersion), request.statement)
  return store.run(async tx => {
    await tx.authorize()
    const row = await tx.read(request.id)
    if (!row || row.reporterAccountId !== accountId) throw new CaseManagementFailure('NOT_FOUND')
    const current = projectCaseDetail(row)
    if (current.id !== request.id) throw Error('Appeal target mismatch')
    if (row.appeal !== undefined) {
      if (!row.appeal || typeof row.appeal !== 'object' || Array.isArray(row.appeal)) throw Error('Invalid appeal record')
      const appeal = row.appeal as Record<string, unknown>
      if (appeal.requestId !== request.requestId || appeal.fingerprint !== fingerprint) throw new CaseManagementFailure('CONFLICT')
      if (typeof appeal.acceptedVersion !== 'number' || !Number.isSafeInteger(appeal.acceptedVersion)) throw Error('Invalid appeal receipt')
      return { reportId: current.id, acceptedVersion: appeal.acceptedVersion, requestId: request.requestId }
    }
    if (current.status !== 'closed' || current.version !== request.expectedVersion || current.version >= Number.MAX_SAFE_INTEGER) throw new CaseManagementFailure('CONFLICT')
    const at = store.now()
    if (!Number.isFinite(Date.parse(at))) throw Error('Invalid appeal clock')
    const acceptedVersion = current.version + 1
    await tx.update(current.id, { status: 'open', outcome: null, resolution: '', caseVersion: acceptedVersion, updatedAt: at,
      appeal: { statement: request.statement, submittedAt: at, requestId: request.requestId, fingerprint, acceptedVersion,
        previousVersion: current.version, previousOutcome: current.outcome, previousResolution: current.resolution } })
    await tx.audit(store.identifier('report-appeal-audit', current.id, request.requestId), { action: 'governance.case.appealed', caseId: current.id, revision: acceptedVersion, at })
    return { reportId: current.id, acceptedVersion, requestId: request.requestId }
  })
}
