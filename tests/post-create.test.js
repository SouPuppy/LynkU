const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { createUserPost, moderateText } = require('@lynku/server')
const input = { title: 'hello', content: 'campus', category_id: 'campus', anonymous: true, request_id: 'request-123' }
const author = { profile_version: 0, nickname: 'Secret Author', avatar_url: '/secret' }
function fixture() {
  let posts = new Map(), category = { _id: 'campus', name: 'Campus', status: 'active', post_count: 0 }, tail = Promise.resolve()
  const flags = { failCounter: false, failRead: false, denyRate: false, flagged: false, author: { ...author, _openid: 'alice', verified: true } }
  const store = {
    existing: async id => { if (flags.failRead) throw Error('offline'); return posts.get(id) || null },
    identifier: (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex'),
    allowCreate: async () => { if (flags.denyRate) throw Error('rate denied') },
    moderate: () => ({ clean: !flags.flagged }), now: () => '2026-09-21T00:00:00.000Z',
    run(operation) {
      const result = tail.then(async () => {
        const next = new Map(posts); let nextCategory = { ...category }; let wrote = false
        const result = await operation({
          author: async () => flags.author,
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
  await assert.rejects(createUserPost(f.store, 'alice', input), /counter failed/)
  assert.equal(f.posts().size, 0); assert.equal(f.category().post_count, 0)
  f.flags.failCounter = false
  const results = await Promise.all([createUserPost(f.store, 'alice', input), createUserPost(f.store, 'alice', input)])
  assert.deepEqual(results.map(result => result.status), ['created', 'duplicate'])
  assert.equal(f.posts().size, 1); assert.equal(f.category().post_count, 1)
  assert.equal(Object.keys(results[0].post).sort().join(','), '_id,revision,status')
  const stored = [...f.posts().values()][0]
  assert.equal(stored.author.nickname, '匿名用户')
  f.flags.denyRate = true
  assert.equal((await createUserPost(f.store, 'alice', input)).status, 'duplicate')
  await assert.rejects(createUserPost(f.store, 'alice', { ...input, content: 'changed' }), { code: 'CONFLICT' })
})

test('post creation uses the profile committed during moderation and cannot write after verification is revoked', async () => {
  const f = fixture()
  f.store.moderate = async () => { f.flags.author = { ...f.flags.author, nickname: 'Updated', profile_version: 2 }; return { clean: true } }
  await createUserPost(f.store, 'alice', { ...input, anonymous: false })
  assert.equal([...f.posts().values()][0].author.nickname, 'Updated')
  assert.equal([...f.posts().values()][0].author.profile_version, 2)
  f.store.moderate = async () => { f.flags.author.verified = false; return { clean: true } }
  await assert.rejects(createUserPost(f.store, 'alice', { ...input, request_id: 'another-request' }), { code: 'EMAIL_NOT_VERIFIED' })
  assert.equal(f.posts().size, 1)
})

test('expired official check never writes a post or category count after a late pass', async () => {
  const f = fixture()
  let now = 0, expire, finish
  const clock = { now: () => now, schedule: (_ms, callback) => { expire = callback; return () => {} } }
  f.store.moderate = text => moderateText({ clock, check: () => new Promise(resolve => { finish = resolve }) }, 'alice', 3, text)
  const operation = createUserPost(f.store, 'alice', input)
  const rejected = assert.rejects(operation, { code: 'MODERATION_UNAVAILABLE' })
  for (let i = 0; i < 6; i++) await Promise.resolve()
  assert.equal(typeof expire, 'function')
  now = 6000; expire()
  await rejected
  finish({ errcode: 0, result: { suggest: 'pass' } })
  for (let i = 0; i < 6; i++) await Promise.resolve()
  assert.equal(f.posts().size, 0)
  assert.equal(f.category().post_count, 0)
})
test('post create rejects malformed inputs, read faults and failed checks without saving candidates', async () => {
  const f = fixture()
  for (const data of [{ ...input, request_id: undefined }, { ...input, anonymous: 'false' }, { ...input, category_id: {} }]) {
    await assert.rejects(createUserPost(f.store, 'alice', data), { code: 'INVALID_INPUT' })
  }
  f.flags.failRead = true
  await assert.rejects(createUserPost(f.store, 'alice', input), /offline/)
  assert.equal(f.posts().size, 0)
  f.flags.failRead = false; f.flags.flagged = true
  await assert.rejects(createUserPost(f.store, 'alice', input), { code: 'CONTENT_REJECTED' })
  assert.equal(f.posts().size, 0); assert.equal(f.category().post_count, 0)
  f.store.moderate = async () => ({ clean: 'true' })
  await assert.rejects(createUserPost(f.store, 'alice', input), { code: 'MODERATION_UNAVAILABLE' })
  assert.equal(f.posts().size, 0)
})
