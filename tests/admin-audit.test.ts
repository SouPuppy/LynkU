import test from 'node:test'
import assert from 'node:assert/strict'
import { readAdminAudit, readAdminAuditEvent, AdminAuditInputFailure, projectAdminAudit } from '../packages/server/src/admin/audit'
import { type AdminAuditQuery } from '../packages/contracts/src/admin-audit'

const at = '2026-09-22T00:00:00.000Z'
const rows = Array.from({ length: 57 }, (_, index) => ({ _id: `audit-${String(100 - index).padStart(3, '0')}`, at: new Date(at), action: 'category.update', target: 'category', actor: 'operator', reason: '调整分类', result: 'applied', revision: index + 1, requestId: 'request', reporterAccountId: 'private', _openid: 'private', token: 'private' }))
test('audit pagination covers equal timestamps without duplicates and binds filters to cursor', async () => {
  const store = { list: async (query: AdminAuditQuery, take: number) => rows.filter(row => !query.cursor || row._id < query.cursor.id).slice(0, take) }
  let query: AdminAuditQuery = { operation: 'category.update', target: 'category', actor: 'operator', cursor: null, limit: 25 }
  const ids: string[] = []
  do {
    const page = await readAdminAudit(store, query)
    ids.push(...page.items.map(item => item.id))
    if (page.nextCursor) await assert.rejects(readAdminAudit(store, { ...query, actor: 'other', cursor: page.nextCursor }), AdminAuditInputFailure)
    query = { ...query, cursor: page.nextCursor }
  } while (query.cursor)
  assert.deepEqual(ids, rows.map(row => row._id))
  assert.equal(new Set(ids).size, 57)
})
test('audit projection exposes only operational fields and does not invent missing results', async () => {
  const event = await readAdminAuditEvent({ read: async () => rows[0] }, rows[0]!._id)
  assert.deepEqual(Object.keys(event).sort(), ['action', 'actor', 'at', 'id', 'reason', 'requestId', 'result', 'revision', 'target'].sort())
  assert.equal(JSON.stringify(event).includes('private'), false)
  const report = projectAdminAudit({ _id: 'report', action: 'governance.report.created', caseId: 'case', at: new Date(at), reporterAccountId: 'private' })
  assert.equal(report.actor, null); assert.equal(report.result, null); assert.equal(report.target, 'case')
  await assert.rejects(readAdminAudit({ list: async () => [rows[1], rows[0]] }, {}), /scope mismatch/)
  await assert.rejects(readAdminAudit({ list: async () => rows.slice(0, 1) }, { actor: 'wrong' }), /scope mismatch/)
})
