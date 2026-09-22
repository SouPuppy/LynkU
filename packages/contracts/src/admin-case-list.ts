export interface AdminCaseSummary { id: string; targetType: 'post' | 'comment'; targetId: string; reason: string; status: 'open' | 'closed'; createdAt: string; updatedAt: string; appealed: boolean }
export interface AdminCaseCursor { id: string; updatedAt: string; scope: string }
export interface AdminCaseQuery { status: 'all' | 'open' | 'closed'; targetType: 'all' | 'post' | 'comment'; targetId: string; limit: number; cursor: AdminCaseCursor | null }
export interface AdminCasePage { items: AdminCaseSummary[]; nextCursor: AdminCaseCursor | null }
function row(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid case list'); return value as Record<string, unknown> }
function text(value: unknown, max = 128): string { if (typeof value !== 'string' || value.length > max || value.trim() !== value) throw Error('Invalid case list text'); return value }
function date(value: unknown): string { const result = text(value, 24); if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw Error('Invalid case list date'); return result }
export function adminCaseScope(query: Pick<AdminCaseQuery, 'status' | 'targetType' | 'targetId'>): string { return JSON.stringify(['admin-cases:1', query.status, query.targetType, query.targetId]) }
function cursor(value: unknown): AdminCaseCursor { const input = row(value), id = text(input.id); if (!id) throw Error('Missing cursor ID'); return { id, updatedAt: date(input.updatedAt), scope: text(input.scope, 1024) } }
export function parseAdminCaseQuery(value: unknown): AdminCaseQuery {
  const input = row(value), status = input.status ?? 'open', targetType = input.targetType ?? 'all', limit = input.limit ?? 25
  if (status !== 'all' && status !== 'open' && status !== 'closed' || targetType !== 'all' && targetType !== 'post' && targetType !== 'comment'
    || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || input.offset !== undefined) throw Error('Invalid case filter')
  const query: AdminCaseQuery = { status, targetType, targetId: text(input.targetId ?? ''), limit, cursor: input.cursor == null ? null : cursor(input.cursor) }
  if (query.cursor && query.cursor.scope !== adminCaseScope(query)) throw Error('Case cursor filter mismatch')
  return query
}
export function parseAdminCaseSummary(value: unknown): AdminCaseSummary {
  const input = row(value), id = text(input.id), targetId = text(input.targetId), reason = text(input.reason, 100)
  if (!id || !targetId || !reason || input.status !== 'open' && input.status !== 'closed' || input.targetType !== 'post' && input.targetType !== 'comment' || typeof input.appealed !== 'boolean') throw Error('Invalid case summary')
  return { id, targetId, reason, status: input.status, targetType: input.targetType, createdAt: date(input.createdAt), updatedAt: date(input.updatedAt), appealed: input.appealed }
}
export function adminCasePrecedes(before: { id: string; updatedAt: string }, after: { id: string; updatedAt: string }): boolean { return before.updatedAt > after.updatedAt || before.updatedAt === after.updatedAt && before.id > after.id }
export function parseAdminCasePage(value: unknown): AdminCasePage {
  const input = row(value)
  if (!Array.isArray(input.items) || input.items.length > 50) throw Error('Invalid case page')
  const items = input.items.map(parseAdminCaseSummary), nextCursor = input.nextCursor === null ? null : cursor(input.nextCursor), last = items[items.length - 1]
  if (items.some((item, index) => index > 0 && !adminCasePrecedes(items[index - 1]!, item)) || nextCursor && (!last || last.id !== nextCursor.id || last.updatedAt !== nextCursor.updatedAt)) throw Error('Invalid case page ordering')
  return { items, nextCursor }
}
