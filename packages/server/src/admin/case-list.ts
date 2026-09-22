import { adminCasePrecedes, adminCaseScope, parseAdminCaseQuery, parseAdminCasePage, type AdminCaseQuery, type AdminCasePage } from '@lynku/contracts'
import { projectAdminCase } from './views'
export class AdminCaseInputFailure extends Error {}
export async function readAdminCases(store: { list(query: AdminCaseQuery, take: number): Promise<unknown[]> }, input: unknown): Promise<AdminCasePage> {
  let query: AdminCaseQuery
  try { query = parseAdminCaseQuery(input) } catch { throw new AdminCaseInputFailure() }
  const rows = await store.list(query, query.limit + 1)
  if (rows.length > query.limit + 1) throw Error('Case list exceeded limit')
  const cases = rows.map(projectAdminCase)
  cases.forEach((item, index) => {
    const before = index ? cases[index - 1] : query.cursor
    if (before && !adminCasePrecedes(before, item) || query.status !== 'all' && item.status !== query.status
      || query.targetType !== 'all' && item.targetType !== query.targetType || query.targetId && item.targetId !== query.targetId) throw Error('Case query scope mismatch')
  })
  const items = cases.slice(0, query.limit), last = items[items.length - 1]
  return parseAdminCasePage({ items, nextCursor: cases.length > query.limit && last ? { id: last.id, updatedAt: last.updatedAt, scope: adminCaseScope(query) } : null })
}
