const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { listPublicPosts } = require('@lynku/server')
const { postPrecedes, parsePublicPostPage } = require('@lynku/contracts')
const identifier = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex')
const post = id => ({ _id: id, _openid: 'alice', title: 'Campus', content: 'News', category_id: 'campus',
  anonymous: false, author: { nickname: 'Alice', avatar_url: '' }, status: 'published', revision: 1,
  view_count: 0, comment_count: 0, created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z' })

test('public keyset pagination survives insertion/deletion and same-time pages without duplicates or omissions', async () => {
  let rows = Array.from({ length: 73 }, (_, i) => post(String(i).padStart(3, '0'))).reverse()
  const store = { identifier, count: async () => rows.length, list: async (request, take) => rows.filter(row =>
    !request.cursor || postPrecedes({ _id: request.cursor.id, created_at: request.cursor.createdAt }, row)).slice(0, take) }
  let page = await listPublicPosts(store, '', { limit: 10 }), seen = page.items.map(p => p._id)
  rows = [post('new'), ...rows.filter(row => row._id !== seen[0])]
  while (page.hasMore) { page = await listPublicPosts(store, '', { limit: 10, cursor: page.nextCursor }); seen.push(...page.items.map(p => p._id)) }
  assert.equal(seen.length, 73); assert.equal(new Set(seen).size, 73); assert.equal(seen.includes('new'), false)
  assert.equal(page.nextCursor, null)
})

test('public post cursors bind filter and search; offset and invalid adapter scopes are rejected', async () => {
  const store = { identifier, count: async () => 2, list: async () => [post('b'), post('a')] }
  const page = await listPublicPosts(store, 'alice', { limit: 1, category_id: 'campus' })
  for (const request of [{ offset: 0 }, { cursor: page.nextCursor }, { category_id: 'different', cursor: page.nextCursor }]) {
    await assert.rejects(listPublicPosts(store, 'alice', request), { code: 'INVALID_INPUT' })
  }
  await assert.rejects(listPublicPosts(store, '', { category_id: 'wrong' }), /scope/)
  await assert.rejects(listPublicPosts(store, '', { query: 'absent' }, true), /scope/)
  await assert.rejects(listPublicPosts({ ...store, list: async () => [{ ...post('b'), status: 'flagged' }] }, '', {}), /scope/)
  assert.throws(() => parsePublicPostPage({ ...page, nextCursor: null }))
})
