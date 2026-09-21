const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { saveUserDraft, deleteUserDraft, listUserDrafts } = require('@lucky/server')
const request = { request_id: 'request-123', title: 'one', content: '', category_id: '', anonymous: false }
function fixture() {
  let drafts = new Map(), counters = new Map(), tail = Promise.resolve()
  const control = { failCounter: false, failRead: false }
  const store = {
    identifier: (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex'),
    now: () => '2026-09-21T00:00:00.000Z', authorizeSave: async () => {},
    list: async owner => [...drafts.values()].filter(row => row._openid === owner),
    run(operation) {
      const result = tail.then(async () => {
        const next = new Map(drafts), counts = new Map(counters)
        const answer = await operation({
          draft: async id => { if (control.failRead) throw Error('read offline'); return next.get(id) || null },
          counter: async owner => counts.get(owner) || null,
          putDraft: async (id, row) => { next.set(id, row) },
          putCounter: async (owner, count) => { if (control.failCounter) throw Error('counter offline'); counts.set(owner, { _openid: owner, count }) },
          removeDraft: async id => { next.delete(id) },
        })
        drafts = next; counters = counts; return answer
      })
      tail = result.catch(() => {})
      return result
    },
  }
  return { store, control, count: () => counters.get('alice')?.count || 0 }
}
test('draft create and delete roll back with their counter and duplicate creates converge', async () => {
  const f = fixture()
  f.control.failCounter = true
  await assert.rejects(saveUserDraft(f.store, 'alice', request), /counter offline/)
  assert.deepEqual(await listUserDrafts(f.store, 'alice'), [])
  f.control.failCounter = false
  const results = await Promise.all([saveUserDraft(f.store, 'alice', request), saveUserDraft(f.store, 'alice', request)])
  assert.deepEqual(results.map(row => row.status), ['created', 'duplicate'])
  assert.equal(f.count(), 1)
  assert.equal('_openid' in results[0].draft, false)
  assert.equal('request_fingerprint' in results[0].draft, false)
  await assert.rejects(saveUserDraft(f.store, 'alice', { ...request, title: 'changed' }), { code: 'CONFLICT' })
  const id = results[0].draft._id
  await assert.rejects(deleteUserDraft(f.store, 'bob', id), { code: 'FORBIDDEN' })
  f.control.failCounter = true
  await assert.rejects(deleteUserDraft(f.store, 'alice', id), /counter offline/)
  assert.equal((await listUserDrafts(f.store, 'alice')).length, 1)
  f.control.failCounter = false
  await deleteUserDraft(f.store, 'alice', id)
  await deleteUserDraft(f.store, 'alice', id)
  assert.equal(f.count(), 0)
})
test('draft saves require typed inputs and revisions, and never turn read faults into creates', async () => {
  const f = fixture()
  for (const invalid of [{ ...request, request_id: undefined }, { ...request, anonymous: 'false' },
    { ...request, title: 42 }, { ...request, draft_id: 'draft', request_id: undefined }]) {
    await assert.rejects(saveUserDraft(f.store, 'alice', invalid), { code: 'INVALID_INPUT' })
  }
  f.control.failRead = true
  await assert.rejects(saveUserDraft(f.store, 'alice', request), /read offline/)
  assert.equal(f.count(), 0)
  f.control.failRead = false
  const created = await saveUserDraft(f.store, 'alice', request)
  const update = { ...request, request_id: undefined, draft_id: created.draft._id, expected_revision: 1, title: 'new' }
  const outcomes = await Promise.allSettled([saveUserDraft(f.store, 'alice', update), saveUserDraft(f.store, 'alice', update)])
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
  assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.code, 'DRAFT_CONFLICT')
  assert.equal((await listUserDrafts(f.store, 'alice'))[0].revision, 2)
})

test('conditional draft cleanup preserves a newer revision without changing its counter', async () => {
  const f = fixture()
  const created = await saveUserDraft(f.store, 'alice', request)
  const id = created.draft._id
  await saveUserDraft(f.store, 'alice', { ...request, request_id: undefined, draft_id: id, expected_revision: 1, title: 'newer' })
  await assert.rejects(deleteUserDraft(f.store, 'alice', id, 1), { code: 'DRAFT_CONFLICT' })
  assert.equal(f.count(), 1)
  assert.equal((await listUserDrafts(f.store, 'alice'))[0].title, 'newer')
  await deleteUserDraft(f.store, 'alice', id, 2)
  assert.equal(f.count(), 0)
})
