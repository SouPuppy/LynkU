import { adminUserPrecedes, adminUserScope, parseAdminUserQuery, parseAdminUserPage, type AdminUserQuery, type AdminUserPage } from '@lynku/contracts'
import { projectAdminUser } from './views'
export interface AdminUserStore { list(query: AdminUserQuery, take: number): Promise<unknown[]> }
export class AdminUserInputFailure extends Error {}
export async function readAdminUsers(store: AdminUserStore, input: unknown): Promise<AdminUserPage> {
  let query: AdminUserQuery
  try { query = parseAdminUserQuery(input) } catch { throw new AdminUserInputFailure('Invalid user filter') }
  const rows = await store.list(query, query.limit + 1)
  if (rows.length > query.limit + 1) throw Error('User query exceeded bound')
  const users = rows.map(projectAdminUser)
  users.forEach((user, index) => {
    const before = index ? users[index - 1] : query.cursor
    if (before && !adminUserPrecedes(before, user) || query.verification !== 'all' && user.verified !== (query.verification === 'verified')
      || !user.displayName.toLowerCase().includes(query.query.toLowerCase())) throw Error('User query scope mismatch')
  })
  const items = users.slice(0, query.limit), last = items[items.length - 1]
  return parseAdminUserPage({ items, nextCursor: users.length > query.limit && last ? { id: last.id, createdAt: last.createdAt, scope: adminUserScope(query) } : null })
}
