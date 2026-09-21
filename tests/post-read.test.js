const assert = require('node:assert/strict')
const test = require('node:test')
const { readPost } = require('@lucky/server')
const post = { _id: 'post', _openid: 'alice', title: 'Title', content: 'Body', category_id: '', category: null,
  anonymous: true, status: 'published', revision: 1, view_count: 0, comment_count: 0,
  created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z' }
test('post detail separates public, owner editing and admin inspection with bounded side effects', async () => {
  let current = post, views = 0, adminReads = 0
  const store = { post: async () => current, isAdmin: async viewer => { adminReads++; return viewer === 'admin' },
    incrementView: async () => { views++ } }
  const result = await readPost(store, '', { post_id: 'post' })
  assert.equal(result.view_count, 1); assert.equal(result.is_mine, false)
  assert.equal(views, 1); assert.equal(adminReads, 0)
  await readPost(store, 'alice', { post_id: 'post', for_edit: true })
  assert.equal(views, 1)
  await assert.rejects(readPost(store, 'admin', { post_id: 'post', for_edit: true }), { code: 'FORBIDDEN' })
  current = { ...post, status: 'flagged' }
  await assert.rejects(readPost(store, '', { post_id: 'post' }), { code: 'NOT_FOUND' })
  assert.equal(adminReads, 0)
  await assert.rejects(readPost(store, 'bob', { post_id: 'post' }), { code: 'NOT_FOUND' })
  assert.equal((await readPost(store, 'admin', { post_id: 'post' })).status, 'flagged')
  assert.equal((await readPost(store, 'alice', { post_id: 'post', for_edit: true })).is_mine, true)
  assert.equal(views, 1)
  current = { ...post, status: 'deleted' }
  await assert.rejects(readPost(store, 'admin', { post_id: 'post' }), { code: 'NOT_FOUND' })
})
test('post detail rejects invalid requests before storage and invalid records before view writes', async () => {
  let reads = 0, writes = 0
  const store = { post: async () => { reads++; return { ...post, view_count: Number.MAX_SAFE_INTEGER } },
    isAdmin: async () => false, incrementView: async () => { writes++ } }
  for (const request of [{ post_id: '' }, { post_id: 'post', for_edit: 'false' }, { post_id: 'post', public_only: 'true' }]) {
    await assert.rejects(readPost(store, 'alice', request), { code: 'INVALID_INPUT' })
  }
  assert.equal(reads, 0)
  await assert.rejects(readPost(store, '', { post_id: 'post' }), /overflow/)
  assert.equal(writes, 0)
  await assert.rejects(readPost({ ...store, post: async () => ({ ...post, status: 'flagged' }),
    isAdmin: async () => { throw Error('identity database offline') } }, 'admin', { post_id: 'post' }), /identity database offline/)
})
