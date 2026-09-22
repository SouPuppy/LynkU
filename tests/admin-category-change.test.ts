import test from 'node:test'
import assert from 'node:assert/strict'
import { changeManagedCategory, type CategoryChangeTransaction } from '@lynku/server'
import type { CategoryChangeReceipt, ManagedCategory } from '@lynku/contracts'
const initial: ManagedCategory = { _id: 'campus', name: 'Campus', description: '', sort_order: 1, post_count: 12, status: 'active', managementRevision: 0 }
const request = { requestId: 'category-request-0001', reason: '调整展示顺序', category: { ...initial, sort_order: 2, post_count: 999 } }
function fixture() {
  let category = { ...initial }, receipts = new Map<string, { fingerprint: string; result: CategoryChangeReceipt }>(), tail = Promise.resolve()
  let revoked = false, failAudit = false, writes = 0
  return {
    state: () => ({ category, receipts, writes }), revoke: () => { revoked = true }, breakAudit: () => { failAudit = true },
    store: { now: () => '2026-09-22T00:00:00.000Z', run<T>(work: (tx: CategoryChangeTransaction) => Promise<T>) {
      const result = tail.then(async () => {
        let next = { ...category }; const pending = new Map(receipts); let count = 0
        const value = await work({ authorize: async () => { if (revoked) throw Error('revoked') }, read: async () => next,
          receipt: async id => pending.get(id) ?? null,
          update: async (_id, fields) => { next = { ...next, ...fields }; count++ },
          record: async (id, fingerprint, result) => { if (failAudit) throw Error('audit unavailable'); pending.set(id, { fingerprint, result }) },
        })
        category = next; receipts = pending; writes += count; return value
      })
      tail = result.then(() => {}, () => {}); return result
    } },
  }
}
test('category edit retries commit once, preserve live counts and reject changed payloads', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([changeManagedCategory(f.store, request), changeManagedCategory(f.store, request)])
  assert.deepEqual(a, b); assert.equal(f.state().writes, 1)
  assert.equal(a.category.post_count, 12); assert.equal(a.category.managementRevision, 1)
  await assert.rejects(changeManagedCategory(f.store, { ...request, reason: 'different' }), { code: 'CONFLICT' })
})
test('two independent edits of one category revision cannot overwrite one another', async () => {
  const f = fixture()
  const result = await Promise.allSettled([changeManagedCategory(f.store, request), changeManagedCategory(f.store, { ...request, requestId: 'category-request-0002' })])
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(f.state().writes, 1); assert.equal(f.state().receipts.size, 1)
})
test('audit failure rolls back edit and revoked members cannot replay successful receipts', async () => {
  const failing = fixture(); failing.breakAudit()
  await assert.rejects(changeManagedCategory(failing.store, request), /audit unavailable/)
  assert.deepEqual(failing.state().category, initial); assert.equal(failing.state().receipts.size, 0)
  const f = fixture(); await changeManagedCategory(f.store, request); f.revoke()
  await assert.rejects(changeManagedCategory(f.store, request), /revoked/)
})
