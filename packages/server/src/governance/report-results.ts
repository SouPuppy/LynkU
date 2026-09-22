import { parseReportPageRequest, parseReportPage, reportPrecedes } from '@lynku/contracts'
import { projectCaseDetail, CaseManagementFailure } from './case-management'
export async function listOwnReports(store: {
  identifier(...parts: string[]): string
  list(accountId: string, request: ReturnType<typeof parseReportPageRequest>, take: number): Promise<unknown[]>
}, accountId: string, input: unknown) {
  let request
  try { request = parseReportPageRequest(input) } catch { throw new CaseManagementFailure('INVALID_INPUT') }
  const scope = store.identifier('own-reports:1', accountId)
  if (!accountId || request.cursor && request.cursor.scope !== scope) throw new CaseManagementFailure('INVALID_INPUT')
  const values = await store.list(accountId, request, request.limit + 1)
  if (values.length > request.limit + 1) throw Error('Unbounded report query')
  const results = values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).reporterAccountId !== accountId) throw Error('Report ownership mismatch')
    const item = projectCaseDetail(value)
    return { reportId: item.id, createdAt: item.createdAt, version: item.version, status: item.status, outcome: item.outcome, resolution: item.resolution, ...(item.appeal ? { appealed: true } : {}) }
  })
  if (request.cursor && results[0] && !reportPrecedes(request.cursor, { id: results[0].reportId, createdAt: results[0].createdAt })) throw Error('Report cursor mismatch')
  if (results.some((item, index) => index > 0 && !reportPrecedes({ id: results[index - 1]!.reportId, createdAt: results[index - 1]!.createdAt }, { id: item.reportId, createdAt: item.createdAt }))) throw Error('Report query ordering mismatch')
  const items = results.slice(0, request.limit), last = items[items.length - 1]
  return parseReportPage({ items, nextCursor: results.length > request.limit && last ? { id: last.reportId, createdAt: last.createdAt, scope } : null })
}
