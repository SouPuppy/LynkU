const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')
const { submitReport } = require('@lynku/server')

const request = { requestId: 'report-request-1234', target: { type: 'post', id: 'post-1' }, reasonCode: 'HARASSMENT', statement: '请处理这条内容。' }
function fixture() {
  let cases = new Map(), audits = new Map(), queue = Promise.resolve(), target = { status: 'published' }
  const store = {
    identifier: (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex'),
    now: () => '2026-09-21T12:00:00.000Z',
    target: async () => target,
    existing: async id => cases.get(id) ?? null,
    run(work) {
      const result = queue.then(async () => {
        const stagedCases = new Map(cases), stagedAudits = new Map(audits)
        const receipt = await work({ existing: async id => stagedCases.get(id) ?? null,
          put: async (id, row) => stagedCases.set(id, row), audit: async (id, row) => stagedAudits.set(id, row) })
        cases = stagedCases; audits = stagedAudits; return receipt
      })
      queue = result.catch(() => {}); return result
    },
  }
  return { store, cases: () => cases, audits: () => audits, unavailable: () => { target = null } }
}
test('report intake creates one private, auditable receipt and concurrent retries converge', async () => {
  const f = fixture()
  const values = await Promise.all([submitReport(f.store, 'account-1', request), submitReport(f.store, 'account-1', request)])
  assert.deepEqual(values[0], values[1]); assert.equal(f.cases().size, 1); assert.equal(f.audits().size, 1)
  const row = [...f.cases().values()][0]
  assert.equal(row.status, 'open'); assert.equal(row.targetId, 'post-1'); assert.equal(JSON.stringify(values).includes('account-1'), false)
})
test('report intake rejects malformed or unavailable targets without creating a case', async () => {
  const f = fixture()
  await assert.rejects(submitReport(f.store, 'account-1', { ...request, target: { type: 'users', id: 'x' } }), { code: 'INVALID_INPUT' })
  f.unavailable()
  await assert.rejects(submitReport(f.store, 'account-1', request), { code: 'NOT_FOUND' })
  assert.equal(f.cases().size, 0)
})
test('a stable report request cannot be rebound to another target or reason', async () => {
  const f = fixture(); await submitReport(f.store, 'account-1', request)
  await assert.rejects(submitReport(f.store, 'account-1', { ...request, reasonCode: 'FRAUD' }), { code: 'CONFLICT' })
  assert.equal(f.cases().size, 1)
})
test('report accepts the current client mutation key format', async () => {
  const f = fixture()
  const result = await submitReport(f.store, 'account-1', { ...request, requestId: 'req_mf20k9_abcdefghijk' })
  assert.equal(result.status, 'open')
})
