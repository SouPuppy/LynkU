const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { createUserPost } = require('@lucky/server')
const input = { title: 'hello', content: 'campus', category_id: 'campus', anonymous: true, request_id: 'request-123' }
const author = { profile_version: 0, nickname: 'Secret Author', avatar_url: '/secret' }
function fixture() {
  let posts = new Map(), category = { _id: 'campus', name: 'Campus', status: 'active', post_count: 0 }, tail = Promise.resolve()
  const flags = { failCounter: false, failRead: false, denyRate: false, flagged: false }
  const store = {
    existing: async id => { if (flags.failRead) throw Error('offline'); return posts.get(id) || null },
    identifier: (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex'),
    allowCreate: async () => { if (flags.denyRate) throw Error('rate denied') },
    moderate: () => ({ clean: !flags.flagged }), now: () => '2026-09-21T00:00:00.000Z',
    run(operation) {
      const result = tail.then(async () => {
        const next = new Map(posts); let nextCategory = { ...category }; let wrote = false
        const result = await operation({
          post: async id => { assert.equal(wrote, false); return next.get(id) || null },
          category: async () => { assert.equal(wrote, false); return nextCategory },
          putPost: async (id, row) => { wrote = true; next.set(id, row) },
          setCategoryCount: async (id, count) => { if (flags.failCounter) throw Error('counter failed'); nextCategory.post_count = count },
        })
        posts = next; category = nextCategory; return result
      })
      tail = result.catch(() => {}); return result
    },
  }
  return { store, flags, posts: () => posts, category: () => category }
}
test('post creation and category count roll back together; concurrent duplicate requests converge', async () => {
  const f = fixture()
  f.flags.failCounter = true
  await assert.rejects(createUserPost(f.store, 'alice', author, input), /counter failed/)
  assert.equal(f.posts().size, 0); assert.equal(f.category().post_count, 0)
  f.flags.failCounter = false
  const results = await Promise.all([createUserPost(f.store, 'alice', author, input), createUserPost(f.store, 'alice', author, input)])
  assert.deepEqual(results.map(result => result.status), ['created', 'duplicate'])
  assert.equal(f.posts().size, 1); assert.equal(f.category().post_count, 1)
  assert.equal(Object.keys(results[0].post).sort().join(','), '_id,revision,status')
  const stored = [...f.posts().values()][0]
  assert.equal(stored.author.nickname, '匿名用户')
  f.flags.denyRate = true
  assert.equal((await createUserPost(f.store, 'alice', author, input)).status, 'duplicate')
  await assert.rejects(createUserPost(f.store, 'alice', author, { ...input, content: 'changed' }), { code: 'CONFLICT' })
})
test('post create rejects malformed inputs and read faults; moderation excludes published counts', async () => {
  const f = fixture()
  for (const data of [{ ...input, request_id: undefined }, { ...input, anonymous: 'false' }, { ...input, category_id: {} }]) {
    await assert.rejects(createUserPost(f.store, 'alice', author, data), { code: 'INVALID_INPUT' })
  }
  f.flags.failRead = true
  await assert.rejects(createUserPost(f.store, 'alice', author, input), /offline/)
  assert.equal(f.posts().size, 0)
  f.flags.failRead = false; f.flags.flagged = true
  const receipt = await createUserPost(f.store, 'alice', author, { ...input, _category_snapshot: { name: 'injected' } })
  assert.equal(receipt.flagged, true); assert.equal(f.category().post_count, 0)
  assert.equal([...f.posts().values()][0].category.name, 'Campus')
})
