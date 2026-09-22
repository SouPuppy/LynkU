export interface AdminAuditEvent {
  id: string; action: string; at: string; target: string
  actor: string | null; reason: string | null; result: string | null; requestId: string | null; revision: number | null
}
export interface AdminAuditCursor { id: string; at: string; scope: string }
export interface AdminAuditQuery { operation: string; target: string; actor: string; cursor: AdminAuditCursor | null; limit: number }
export interface AdminAuditPage { items: AdminAuditEvent[]; nextCursor: AdminAuditCursor | null }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid audit object')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || value.length > max || value.trim() !== value) throw Error('Invalid audit text')
  return value
}
function date(value: unknown): string {
  const result = text(value, 24)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw Error('Invalid audit date')
  return result
}
export function adminAuditScope(query: Pick<AdminAuditQuery, 'operation' | 'target' | 'actor'>): string {
  return JSON.stringify(['admin-audit:1', query.operation, query.target, query.actor])
}
function cursor(value: unknown): AdminAuditCursor {
  const row = object(value), id = text(row.id)
  if (!id) throw Error('Missing audit cursor ID')
  return { id, at: date(row.at), scope: text(row.scope, 1024) }
}
export function parseAdminAuditQuery(value: unknown): AdminAuditQuery {
  const row = object(value), limit = row.limit ?? 25
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || row.offset !== undefined) throw Error('Invalid audit limit')
  const query = { operation: text(row.operation ?? ''), target: text(row.target ?? ''), actor: text(row.actor ?? ''), limit, cursor: row.cursor == null ? null : cursor(row.cursor) }
  if (query.cursor && query.cursor.scope !== adminAuditScope(query)) throw Error('Audit cursor scope mismatch')
  return query
}
export function parseAdminAuditEvent(value: unknown): AdminAuditEvent {
  const row = object(value), id = text(row.id), action = text(row.action), target = text(row.target)
  if (!id || !action || !target) throw Error('Missing audit field')
  const optional = (value: unknown, max = 128) => value === null ? null : text(value, max)
  const revision = row.revision
  if (revision !== null && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) throw Error('Invalid audit revision')
  return { id, action, target, at: date(row.at), actor: optional(row.actor), reason: optional(row.reason, 2000),
    result: optional(row.result), requestId: optional(row.requestId), revision }
}
export function adminAuditPrecedes(before: { at: string; id: string }, after: { at: string; id: string }): boolean {
  return before.at > after.at || before.at === after.at && before.id > after.id
}
export function parseAdminAuditPage(value: unknown): AdminAuditPage {
  const row = object(value)
  if (!Array.isArray(row.items) || row.items.length > 50) throw Error('Invalid audit page')
  const items = row.items.map(parseAdminAuditEvent), nextCursor = row.nextCursor === null ? null : cursor(row.nextCursor)
  const last = items[items.length - 1]
  if (items.some((item, index) => index > 0 && !adminAuditPrecedes(items[index - 1]!, item))
    || nextCursor && (!last || last.id !== nextCursor.id || last.at !== nextCursor.at)) throw Error('Invalid audit page order')
  return { items, nextCursor }
}
