const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { updateUserPost } = require('@lucky/server')
const author = { profile_version: 0, nickname: 'Alice', avatar_url: '' }
const request = { post_id: 'post', expected_revision: 1, title: 'new', content: 'body', category_id: 'new', anonymous: true }
function fixture() {
  let post = { _id: 'post', _openid: 'alice', revision: 1, status: 'published', category_id: 'old', title: 'old', content: 'body' }
  let categories = new Map([['old', { _id: 'old', name: 'Old', status: 'active', post_count: 1 }], ['new', { _id: 'new', name: 'New', status: 'active', post_count: 0 }]])
  let tail = Promise.resolve()
  const flags = { failSecond: false, denyRate: false }
  const store = {
    existing: async () => post,
    identifier: (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex'),
    moderate: () => ({ clean: true }), now: () => '2026-09-21T00:00:00.000Z',
    allowUpdate: async () => { if (flags.denyRate) throw Error('rate blocked') },
    run(operation) {
      const result = tail.then(async () => {
        let nextPost = { ...post }, nextCategories = new Map([...categories].map(([id, row]) => [id, { ...row }])), wrote = false
        const result = await operation({
          post: async () => { assert.equal(wrote, false); return nextPost },
          category: async id => { assert.equal(wrote, false); return nextCategories.get(id) || null },
          updatePost: async (id, changes) => { wrote = true; nextPost = { ...nextPost, ...changes } },
          setCategoryCount: async (id, count) => { if (id === 'new' && flags.failSecond) throw Error('second counter failed'); nextCategories.get(id).post_count = count },
        })
        post = nextPost; categories = nextCategories; return result
      })
      tail = result.catch(() => {}); return result
    },
  }
  return { store, flags, post: () => post, counts: () => [...categories.values()].map(row => row.post_count) }
}
test('post update moves category counts atomically and retries without incrementing revision twice', async () => {
  const f = fixture(); f.flags.failSecond = true
  await assert.rejects(updateUserPost(f.store, 'alice', author, request), /second counter failed/)
  assert.equal(f.post().revision, 1); assert.deepEqual(f.counts(), [1, 0])
  f.flags.failSecond = false
  const results = await Promise.all([updateUserPost(f.store, 'alice', author, request), updateUserPost(f.store, 'alice', author, request)])
  assert.deepEqual(results.map(result => result.post.revision), [2, 2])
  assert.equal(f.post().author.nickname, '匿名用户')
  assert.deepEqual(f.counts(), [0, 1])
  f.flags.denyRate = true
  assert.equal((await updateUserPost(f.store, 'alice', author, request)).post.revision, 2)
  await assert.rejects(updateUserPost(f.store, 'alice', author, { ...request, title: 'other payload' }), { code: 'CONFLICT' })
  await assert.rejects(updateUserPost(f.store, 'bob', author, request), { code: 'FORBIDDEN' })
})
test('post update rejects missing versions and unavailable categories without changing content', async () => {
  const f = fixture()
  await assert.rejects(updateUserPost(f.store, 'alice', author, { ...request, expected_revision: undefined }), { code: 'INVALID_INPUT' })
  await assert.rejects(updateUserPost(f.store, 'alice', author, { ...request, category_id: 'missing' }), { code: 'INVALID_CATEGORY' })
  assert.equal(f.post().title, 'old')
  assert.deepEqual(f.counts(), [1, 0])
})
