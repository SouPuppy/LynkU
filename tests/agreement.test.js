const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { acceptAgreement } = require('@lynku/server')
const docs = Object.fromEntries(['terms', 'rules'].map(key => [key, { version: '1', hash: key.repeat(16), status: 'active', effectiveAt: '2026-09-21' }]))
const request = { accepted: true, requestId: 'operation-12345678', documentVersions: Object.fromEntries(Object.entries(docs).map(([key, value]) => [key, { version: value.version, hash: value.hash }])) }
function fixture() {
  let lifecycle = { _id: 'lifecycle', currentAccountId: 'account', state: 'active', epoch: 1, writeFence: 0 }
  let rows = new Map(), tail = Promise.resolve(), failWrite = false
  const store = { identifier: (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex'), now: () => '2026-09-21T12:00:00.000Z',
    run(work) {
      const operation = tail.then(async () => {
        const staged = new Map(rows), next = { ...lifecycle }
        const result = await work({
          lifecycle: async () => next,
          assent: async id => staged.get(id) ?? null,
          touchLifecycle: async (id, fence) => { assert.equal(id, next._id); next.writeFence = fence },
          put: async (id, row) => { if (failWrite) throw Error('storage unavailable'); staged.set(id, row) },
        })
        lifecycle = next; rows = staged; return result
      })
      tail = operation.catch(() => {}); return operation
    },
  }
  return { store, rows: () => rows, lifecycle: () => lifecycle, fail: () => { failWrite = true } }
}

test('explicit agreement writes both current document receipts atomically and deduplicates retries', async () => {
  const f = fixture()
  const results = await Promise.all([acceptAgreement(f.store, docs, 'account', request), acceptAgreement(f.store, docs, 'account', request)])
  assert.deepEqual(results[0], results[1]); assert.equal(f.rows().size, 2)
  assert.equal(f.lifecycle().writeFence, 2)
  for (const receipt of results[0].documents) assert.equal(receipt.acceptedAt, '2026-09-21T12:00:00.000Z')
  assert.equal(JSON.stringify(results).includes('account'), false)
})

test('draft, future, mismatching versions or missing explicit choice cannot create assent', async () => {
  const f = fixture()
  for (const input of [{ ...request, accepted: false }, { ...request, accepted: undefined }, { ...request, role: 'admin' }]) {
    await assert.rejects(acceptAgreement(f.store, docs, 'account', input), { code: 'INVALID_INPUT' })
  }
  for (const replacement of [{ ...docs.terms, status: 'draft' }, { ...docs.terms, effectiveAt: '2027-01-01' }]) {
    await assert.rejects(acceptAgreement(f.store, { ...docs, terms: replacement }, 'account', request), { code: 'AGREEMENT_NOT_READY' })
  }
  await assert.rejects(acceptAgreement(f.store, { ...docs, terms: { ...docs.terms, hash: 'changed' } }, 'account', request), { code: 'AGREEMENT_CHANGED' })
  assert.equal(f.rows().size, 0); assert.equal(f.lifecycle().writeFence, 0)
})

test('closure and replaced account bindings are rechecked inside the assent transaction', async () => {
  const f = fixture()
  f.lifecycle().state = 'closing'
  await assert.rejects(acceptAgreement(f.store, docs, 'account', request), { code: 'ACCOUNT_CLOSED' })
  f.lifecycle().state = 'active'; f.lifecycle().currentAccountId = 'replacement'
  await assert.rejects(acceptAgreement(f.store, docs, 'account', request), { code: 'AUTH_UNAVAILABLE' })
  assert.equal(f.rows().size, 0)
})

test('receipt storage failure rolls back the lifecycle fence with both documents', async () => {
  const f = fixture(); f.fail()
  await assert.rejects(acceptAgreement(f.store, docs, 'account', request), /storage unavailable/)
  assert.equal(f.rows().size, 0); assert.equal(f.lifecycle().writeFence, 0)
})
