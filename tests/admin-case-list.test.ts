import test from 'node:test'
import assert from 'node:assert/strict'
import { readAdminCases, AdminCaseInputFailure } from '../packages/server/src/admin/case-list'
import { type AdminCaseQuery } from '../packages/contracts/src/admin-case-list'
const rows = Array.from({ length: 56 }, (_, i) => ({ _id: `case-${String(100 - i).padStart(3, '0')}`, targetType: 'post', targetId: 'post', reasonCode: 'OTHER', status: 'open', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', reporterAccountId: 'secret', requestId: 'private', statement: 'private', appeal: { statement: 'private', submittedAt: '2026-09-22T00:00:00.000Z' } }))
test('case queue traverses all equal-time records and binds cursor to filters', async () => {
  const store = { list: async (query: AdminCaseQuery, take: number) => rows.filter(row => !query.cursor || row._id < query.cursor.id).slice(0, take) }
  let query: AdminCaseQuery = { status: 'open', targetType: 'post', targetId: 'post', cursor: null, limit: 25 }
  const ids: string[] = []
  do {
    const page = await readAdminCases(store, query)
    ids.push(...page.items.map(item => item.id))
    for (const item of page.items) { assert.equal(item.appealed, true); assert.equal(JSON.stringify(item).includes('private'), false); assert.equal(JSON.stringify(item).includes('secret'), false) }
    if (page.nextCursor) await assert.rejects(readAdminCases(store, { ...query, status: 'closed', cursor: page.nextCursor }), AdminCaseInputFailure)
    query = { ...query, cursor: page.nextCursor }
  } while (query.cursor)
  assert.deepEqual(ids, rows.map(row => row._id)); assert.equal(new Set(ids).size, 56)
})
test('case queue rejects out-of-scope data and malformed filters without fallback', async () => {
  const store = { list: async () => rows.slice(0, 1) }
  await assert.rejects(readAdminCases(store, { status: 'closed' }), /scope mismatch/)
  await assert.rejects(readAdminCases(store, { targetType: 'comment' }), /scope mismatch/)
  await assert.rejects(readAdminCases(store, { targetId: 'other' }), /scope mismatch/)
  await assert.rejects(readAdminCases(store, { status: 'anything' }), AdminCaseInputFailure)
  await assert.rejects(readAdminCases(store, { offset: 50 }), AdminCaseInputFailure)
  await assert.rejects(readAdminCases({ list: async () => [{ ...rows[0], updatedAt: undefined }] }, {}), /timestamp/)
})
