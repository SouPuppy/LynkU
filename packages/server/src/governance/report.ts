type Row = Record<string, unknown>

export type ReportTarget = { type: 'post' | 'comment'; id: string }
export class ReportFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT') { super(code) }
}
export interface ReportStore {
  identifier(...parts: string[]): string
  now(): string
  target(target: ReportTarget): Promise<unknown | null>
  existing(id: string): Promise<unknown | null>
  run<T>(work: (tx: { existing(id: string): Promise<unknown | null>; put(id: string, row: Row): Promise<void>; audit(id: string, row: Row): Promise<void> }) => Promise<T>): Promise<T>
}
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportFailure('INVALID_INPUT')
  return value as Row
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new ReportFailure('INVALID_INPUT')
  return value
}
function request(value: unknown): { requestId: string; target: ReportTarget; reasonCode: string; statement: string } {
  const input = record(value)
  if (Object.keys(input).some(key => !['action', 'requestId', 'target', 'reasonCode', 'statement'].includes(key))) throw new ReportFailure('INVALID_INPUT')
  const requestId = text(input.requestId, 128)
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new ReportFailure('INVALID_INPUT')
  const target = record(input.target)
  if (Object.keys(target).length !== 2 || (target.type !== 'post' && target.type !== 'comment')) throw new ReportFailure('INVALID_INPUT')
  const id = text(target.id, 128)
  const reasonCode = text(input.reasonCode, 48)
  if (!/^[A-Z][A-Z0-9_]{1,47}$/.test(reasonCode)) throw new ReportFailure('INVALID_INPUT')
  const statement = input.statement === undefined ? '' : text(input.statement, 1000)
  return { requestId, target: { type: target.type, id }, reasonCode, statement }
}

/** Creates a private case receipt; it never reads or returns target content or reporter identity. */
export async function submitReport(store: ReportStore, reporterAccountId: string, input: unknown) {
  if (!reporterAccountId) throw new ReportFailure('INVALID_INPUT')
  const value = request(input)
  const target = await store.target(value.target)
  if (target === null) throw new ReportFailure('NOT_FOUND')
  const caseId = store.identifier('governance:report', reporterAccountId, value.requestId)
  const existing = await store.existing(caseId)
  if (existing !== null) {
    const row = record(existing)
    if (row.reporterAccountId !== reporterAccountId || row.requestId !== value.requestId
      || row.reasonCode !== value.reasonCode || row.targetType !== value.target.type || row.targetId !== value.target.id) throw new ReportFailure('CONFLICT')
    return { reportId: caseId, status: 'open' as const }
  }
  return store.run(async tx => {
    const prior = await tx.existing(caseId)
    if (prior !== null) {
      const row = record(prior)
      if (row.reporterAccountId !== reporterAccountId || row.requestId !== value.requestId
        || row.reasonCode !== value.reasonCode || row.targetType !== value.target.type || row.targetId !== value.target.id) throw new ReportFailure('CONFLICT')
      return { reportId: caseId, status: 'open' as const }
    }
    const now = store.now()
    if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid report clock')
    await tx.put(caseId, { _id: caseId, kind: 'report', status: 'open', caseVersion: 1, requestId: value.requestId,
      reporterAccountId, targetType: value.target.type, targetId: value.target.id, reasonCode: value.reasonCode,
      statement: value.statement, createdAt: now, updatedAt: now })
    await tx.audit(store.identifier('governance:audit', caseId, 'created'), { _id: store.identifier('governance:audit', caseId, 'created'),
      action: 'governance.report.created', caseId, at: now })
    return { reportId: caseId, status: 'open' as const }
  })
}
