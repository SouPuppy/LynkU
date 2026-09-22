export interface AdminUserSummary { id: string; displayName: string; email: string; verified: boolean; role: string; createdAt: string }
export interface AdminUserCursor { scope: string; id: string; createdAt: string }
export interface AdminUserQuery { query: string; verification: 'all' | 'verified' | 'guest'; limit: number; cursor: AdminUserCursor | null }
export interface AdminUserPage { items: AdminUserSummary[]; nextCursor: AdminUserCursor | null }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid admin user payload')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.trim() !== value) throw Error('Invalid admin user text')
  return value
}
function date(value: unknown): string {
  const result = text(value, 24)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw Error('Invalid admin user date')
  return result
}
export function adminUserScope(query: Pick<AdminUserQuery, 'query' | 'verification'>): string { return JSON.stringify(['admin-users:1', query.query, query.verification]) }
export function parseAdminUserCursor(value: unknown): AdminUserCursor {
  const row = object(value), id = text(row.id, 128)
  if (!id) throw Error('Invalid admin user cursor')
  return { id, createdAt: date(row.createdAt), scope: text(row.scope, 512) }
}
export function parseAdminUserQuery(value: unknown): AdminUserQuery {
  const row = object(value), query = text(row.query ?? '', 80), verification = row.verification ?? 'all', limit = row.limit ?? 25
  if (verification !== 'all' && verification !== 'verified' && verification !== 'guest' || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || row.offset !== undefined) throw Error('Invalid admin user filter')
  const result: AdminUserQuery = { query, verification, limit, cursor: row.cursor == null ? null : parseAdminUserCursor(row.cursor) }
  if (result.cursor && result.cursor.scope !== adminUserScope(result)) throw Error('Admin user cursor scope mismatch')
  return result
}
export function parseAdminUserPage(value: unknown): AdminUserPage {
  const row = object(value)
  if (!Array.isArray(row.items) || row.items.length > 50) throw Error('Invalid admin user page')
  const items = row.items.map(value => {
    const user = object(value)
    if (typeof user.verified !== 'boolean') throw Error('Invalid verification state')
    return { id: text(user.id, 128), displayName: text(user.displayName, 100), email: text(user.email, 254), verified: user.verified, role: text(user.role, 32), createdAt: date(user.createdAt) }
  })
  const nextCursor = row.nextCursor === null ? null : parseAdminUserCursor(row.nextCursor)
  const last = items[items.length - 1]
  if (items.some((item, index) => !item.id || index > 0 && !adminUserPrecedes(items[index - 1]!, item))
    || nextCursor && (!last || last.id !== nextCursor.id || last.createdAt !== nextCursor.createdAt)) throw Error('Invalid admin user page order')
  return { items, nextCursor }
}
export function adminUserPrecedes(before: { id: string; createdAt: string }, after: { id: string; createdAt: string }): boolean {
  return before.createdAt > after.createdAt || before.createdAt === after.createdAt && before.id > after.id
}
