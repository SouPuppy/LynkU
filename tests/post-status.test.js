const assert = require('node:assert/strict')
const test = require('node:test')
const { deleteUserPost } = require('@lynku/server')
function fixture() {
  let post = { _id: 'post', _openid: 'alice', status: 'published', revision: 1, category_id: 'category' }
  let category = { _id: 'category', status: 'active', post_count: 1 }, tail = Promise.resolve()
  const control = { fail: false, auditFail: false, audits: [] }
  const store = {
    existing: async () => post,
    now: () => '2026-09-21T00:00:00.000Z',
    run(operation) {
      const result = tail.then(async () => {
        let nextPost = { ...post }, nextCategory = { ...category }, wrote = false
        await operation({
          audit: async event => { if (control.auditFail) throw Error('audit failed'); control.audits.push(event) },
          post: async () => { assert.equal(wrote, false); return nextPost },
          category: async () => { assert.equal(wrote, false); return nextCategory },
          setStatus: async (id, status, revision) => { wrote = true; nextPost = { ...nextPost, status, revision } },
          setCategoryCount: async (id, count) => { if (control.fail) throw Error('counter failed'); nextCategory.post_count = count },
        })
        post = nextPost; category = nextCategory
      })
      tail = result.catch(() => {}); return result
    },
  }
  return { store, control, post: () => post, count: () => category.post_count }
}
const owner = { id: 'alice', isAdmin: false }, admin = { id: 'admin', isAdmin: true }
test('deletion rolls back with counters and repeated operations preserve the revision', async () => {
  const f = fixture(); f.control.fail = true
  await assert.rejects(deleteUserPost(f.store, owner, 'post'), /counter failed/)
  assert.equal(f.post().status, 'published'); assert.equal(f.count(), 1)
  f.control.fail = false
  await Promise.all([deleteUserPost(f.store, owner, 'post'), deleteUserPost(f.store, owner, 'post')])
  assert.equal(f.post().revision, 2); assert.equal(f.count(), 0)
})

test('administrator status changes require a durable audit in the same transaction', async () => {
  const f = fixture(); f.control.auditFail = true
  await assert.rejects(deleteUserPost(f.store, admin, 'post'), /audit failed/)
  assert.equal(f.post().status, 'published'); assert.equal(f.count(), 1)
  f.control.auditFail = false
  await deleteUserPost(f.store, admin, 'post')
  await deleteUserPost(f.store, admin, 'post')
  assert.equal(f.control.audits.length, 1)
  assert.deepEqual(f.control.audits[0], { actor: 'admin', target: 'post', before: 'published', after: 'deleted', revision: 2, at: '2026-09-21T00:00:00.000Z' })
})
test('deletion checks ownership even after deletion', async () => {
  const f = fixture()
  await assert.rejects(deleteUserPost(f.store, owner, {}), { code: 'INVALID_INPUT' })
  const stranger = { id: 'bob', isAdmin: false }
  await assert.rejects(deleteUserPost(f.store, stranger, 'post'), { code: 'FORBIDDEN' })
  await deleteUserPost(f.store, admin, 'post')
  await assert.rejects(deleteUserPost(f.store, stranger, 'post'), { code: 'FORBIDDEN' })
  assert.equal(f.count(), 0)
})
