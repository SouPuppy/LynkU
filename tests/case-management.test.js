const test = require('node:test')
const assert = require('node:assert/strict')
const { closeCase, readOwnReport } = require('@lynku/server')
const base = { _id: 'case1', targetType: 'post', targetId: 'p1', reasonCode: 'SPAM', statement: 'Please check', status: 'open', caseVersion: 1, createdAt: '2026-09-22T00:00:00.000Z', reporterAccountId: 'private-reporter' }
const request = { id: 'case1', requestId: 'case-operation-0001', expectedVersion: 1, outcome: 'no_violation', reason: '未发现违反社区规则的内容' }
test('case decisions commit once, reject stale decisions and keep reporter private', async () => {
  let stored = { ...base }, receipt = null, audits = 0, tail = Promise.resolve()
  const store = { now: () => base.createdAt, run(work) {
    const result = tail.then(async () => {
      let next = { ...stored }, nextReceipt = receipt, recorded = 0
      const value = await work({ authorize: async () => {}, read: async () => next, receipt: async () => nextReceipt,
        update: async (_id, fields) => { next = { ...next, ...fields } }, record: async (_id, fingerprint, result) => { nextReceipt = { fingerprint, result }; recorded++ },
      })
      stored = next; receipt = nextReceipt; audits += recorded; return value
    }); tail = result.catch(() => {}); return result
  } }
  const [a, b] = await Promise.all([closeCase(store, request), closeCase(store, request)])
  assert.deepEqual(a, b); assert.equal(a.status, 'closed'); assert.equal(a.version, 2); assert.equal(audits, 1)
  assert.equal(JSON.stringify(a).includes('private-reporter'), false)
  await assert.rejects(closeCase(store, { ...request, reason: 'Changed' }), { code: 'CONFLICT' })
  const own = await readOwnReport({ read: async () => stored }, 'private-reporter', { id: 'case1' })
  assert.equal(own.resolution, request.reason)
  await assert.rejects(readOwnReport({ read: async () => stored }, 'another-user', { id: 'case1' }), { code: 'NOT_FOUND' })
})
