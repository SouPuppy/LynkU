import { callCloud, CloudCallError } from './cloud'
import { createRequestId } from '../utils/util'
import { parseReportPage, type ReportCursor } from '../generated/contracts'
export interface AppealRequest { id: string; expectedVersion: number; requestId: string; statement: string }
export async function appealReport(request: AppealRequest): Promise<void> {
  const result = await callCloud<unknown>('governance', { ...request, action: 'appealReport' })
  if (!result || typeof result !== 'object' || !('reportId' in result) || !('acceptedVersion' in result) || !('requestId' in result)
    || result.reportId !== request.id || result.acceptedVersion !== request.expectedVersion + 1 || result.requestId !== request.requestId) throw new CloudCallError('申诉回执尚未确认，请重试原请求', 'INVALID_RESPONSE', 'governance', 'appealReport')
}
export async function listReports(cursor: ReportCursor | null = null) {
  return parseReportPage(await callCloud<unknown>('governance', { action: 'listReports', cursor, limit: 25 }))
}

export type ReportTarget = { type: 'post' | 'comment'; id: string }
export async function submitReport(target: ReportTarget, reasonCode: string, statement = ''): Promise<{ reportId: string; status: 'open' }> {
  const result = await callCloud<unknown>('governance', {
    action: 'submitReport', requestId: createRequestId(), target, reasonCode, statement,
  })
  if (!result || typeof result !== 'object' || !('reportId' in result) || !('status' in result)
    || typeof result.reportId !== 'string' || result.status !== 'open') {
    throw new CloudCallError('举报受理结果无效，请稍后重试', 'INVALID_RESPONSE', 'governance', 'submitReport')
  }
  return { reportId: result.reportId, status: 'open' }
}
