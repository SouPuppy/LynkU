import type { CaseOutcome } from './admin-cases'
export interface ReportResult { reportId: string; status: 'open' | 'closed'; version: number; outcome: CaseOutcome | null; resolution: string; createdAt: string; appealed?: boolean }
export interface ReportCursor { id: string; createdAt: string; scope: string }
export interface ReportPage { items: ReportResult[]; nextCursor: ReportCursor | null }
function row(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid report response'); return value as Record<string, unknown> }
function text(value: unknown, max: number, empty = false): string { if (typeof value !== 'string' || !empty && !value || value.length > max) throw Error('Invalid report field'); return value }
export function parseReportCursor(value: unknown): ReportCursor {
  const input = row(value), id = text(input.id, 128), createdAt = text(input.createdAt, 30), scope = text(input.scope, 64)
  if (!/^[a-f0-9]{64}$/.test(scope) || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw Error('Invalid report cursor')
  return { id, createdAt, scope }
}
export function parseReportPageRequest(value: unknown) {
  const input = row(value), limit = input.limit ?? 25
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || input.offset !== undefined) throw Error('Invalid report pagination')
  return { limit, cursor: input.cursor == null ? null : parseReportCursor(input.cursor) }
}
export function reportPrecedes(a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): boolean { return a.createdAt > b.createdAt || a.createdAt === b.createdAt && a.id > b.id }
export function parseReportPage(value: unknown): ReportPage {
  const input = row(value)
  if (!Array.isArray(input.items) || input.items.length > 50) throw Error('Invalid report results')
  const items = input.items.map<ReportResult>(value => {
    const item = row(value), status = item.status, outcome = item.outcome
    if (status !== 'open' && status !== 'closed' || outcome !== null && outcome !== 'no_violation' && outcome !== 'duplicate' && outcome !== 'hide_post' && outcome !== 'remove_comment'
      || status === 'open' && outcome !== null || status === 'closed' && outcome === null
      || typeof item.version !== 'number' || !Number.isSafeInteger(item.version) || item.version < 1) throw Error('Invalid report result')
    const createdAt = text(item.createdAt, 30)
    if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw Error('Invalid report date')
    if (item.appealed !== undefined && typeof item.appealed !== 'boolean') throw Error('Invalid appeal flag')
    return { reportId: text(item.reportId, 128), status, version: item.version, outcome, createdAt, resolution: text(item.resolution, 1000, status === 'open'), ...(item.appealed === undefined ? {} : { appealed: item.appealed }) }
  })
  const nextCursor = input.nextCursor === null ? null : parseReportCursor(input.nextCursor), last = items[items.length - 1]
  if (items.some((item, i) => i > 0 && !reportPrecedes({ id: items[i - 1]!.reportId, createdAt: items[i - 1]!.createdAt }, { id: item.reportId, createdAt: item.createdAt }))
    || nextCursor && (!last || last.reportId !== nextCursor.id || last.createdAt !== nextCursor.createdAt)) throw Error('Invalid report page boundary')
  return { items, nextCursor }
}
