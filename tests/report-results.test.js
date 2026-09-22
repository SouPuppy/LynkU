const test = require('node:test')
const assert = require('node:assert/strict')
const { listOwnReports } = require('@lynku/server')
const base = { _id: 'report-99', reporterAccountId: 'me', targetType: 'post', targetId: 'private-target', reasonCode: 'SPAM', statement: 'private explanation', status: 'closed', caseVersion: 2, createdAt: '2026-09-22T00:00:00.000Z', outcome: 'no_violation', resolution: '未发现违规' }
test('own report results paginate with scoped cursors and exclude private case details', async () => {
  const rows = Array.from({ length: 53 }, (_, i) => ({ ...base, _id: `report-${99 - i}` }))
  const store = { identifier: (_action, accountId) => (accountId === 'me' ? 'a' : 'b').repeat(64), list: async (_owner, request, take) => rows.filter(row => !request.cursor || row._id < request.cursor.id).slice(0, take) }
  let page = await listOwnReports(store, 'me', { limit: 20 }), firstCursor = page.nextCursor
  const ids = page.items.map(item => item.reportId)
  assert.equal(JSON.stringify(page).includes('private'), false)
  while (page.nextCursor) { page = await listOwnReports(store, 'me', { limit: 20, cursor: page.nextCursor }); ids.push(...page.items.map(item => item.reportId)) }
  assert.equal(new Set(ids).size, 53)
  await assert.rejects(listOwnReports(store, 'other', { cursor: firstCursor }), { code: 'INVALID_INPUT' })
  await assert.rejects(listOwnReports({ ...store, list: async () => [{ ...base, reporterAccountId: 'other' }] }, 'me', {}), /ownership mismatch/)
})
