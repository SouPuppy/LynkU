import { adminAuditPrecedes, adminAuditScope, parseAdminAuditEvent, parseAdminAuditPage, parseAdminAuditQuery,
  type AdminAuditQuery, type AdminAuditPage, type AdminAuditEvent } from '@lynku/contracts'
export class AdminAuditInputFailure extends Error {}
export class AdminAuditNotFound extends Error {}
export function projectAdminAudit(value: unknown): AdminAuditEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid stored audit')
  const row = value as Record<string, unknown>
  // Only operational fields are public to administrators. Never spread a stored record.
  return parseAdminAuditEvent({ id: row._id, action: row.action, at: row.at instanceof Date ? row.at.toISOString() : row.at,
    target: row.target ?? row.caseId, actor: row.actor ?? null, reason: row.reason ?? null,
    result: row.result ?? row.outcome ?? null, requestId: row.requestId ?? null, revision: row.revision ?? null })
}
export async function readAdminAudit(store: { list(query: AdminAuditQuery, take: number): Promise<unknown[]> }, input: unknown): Promise<AdminAuditPage> {
  let query: AdminAuditQuery
  try { query = parseAdminAuditQuery(input) } catch { throw new AdminAuditInputFailure() }
  const rows = await store.list(query, query.limit + 1)
  if (rows.length > query.limit + 1) throw Error('Audit query exceeded limit')
  const events = rows.map(projectAdminAudit)
  events.forEach((event, index) => {
    const before = index ? events[index - 1] : query.cursor
    if (before && !adminAuditPrecedes(before, event) || query.operation && event.action !== query.operation
      || query.target && event.target !== query.target || query.actor && event.actor !== query.actor) throw Error('Audit query scope mismatch')
  })
  const items = events.slice(0, query.limit), last = items[items.length - 1]
  return parseAdminAuditPage({ items, nextCursor: events.length > query.limit && last ? { id: last.id, at: last.at, scope: adminAuditScope(query) } : null })
}
export async function readAdminAuditEvent(store: { read(id: string): Promise<unknown> }, input: unknown): Promise<AdminAuditEvent> {
  if (typeof input !== 'string' || !input || input.length > 128 || input.trim() !== input) throw new AdminAuditInputFailure()
  const row = await store.read(input)
  if (!row) throw new AdminAuditNotFound()
  const event = projectAdminAudit(row)
  if (event.id !== input) throw Error('Audit ID mismatch')
  return event
}
