const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { listOwnedPosts } = require('@lynku/server')
const { parseOwnedPostPage } = require('@lynku/contracts')
const stamp = '2026-09-21T00:00:00.000Z'
const row = id => ({ _id: id, _openid: 'alice', title: 'Title', content: 'Body', category_id: '', category: null,
  anonymous: true, status: 'published', revision: 1, view_count: 0, comment_count: 0, created_at: stamp, updated_at: stamp })
const identifier = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
test('owned post cursors cover tied timestamps across inserts and deletes without linking anonymous authors', async () => {
  let rows = Array.from({ length: 75 }, (_, i) => row(String(1000 - i).padStart(4, '0')))
  const store = { identifier, count: async () => rows.length,
    list: async (owner, cursor, take) => rows.filter(item => item._openid === owner && (!cursor || item._id < cursor.id)).slice(0, take) }
  const seen = []
  let cursor = null
  do {
    const page = await listOwnedPosts(store, 'alice', { cursor, limit: 20 })
    assert.equal(page.items.every(item => item.is_mine && !('_openid' in item) && !('_openid' in item.author)), true)
    seen.push(...page.items.map(item => item._id))
    cursor = page.nextCursor
    if (seen.length === 20) rows = [row('2000'), ...rows.filter(item => item._id !== seen[0])]
  } while (cursor)
  assert.equal(seen.length, 75)
  assert.equal(new Set(seen).size, 75)
  assert.equal(seen.includes('2000'), false)
})
test('owned post application rejects foreign cursors before reads and rejects invalid query boundaries', async () => {
  let reads = 0
  const store = { identifier, count: async () => 2, list: async () => { reads++; return [row('b'), row('a')] } }
  const page = await listOwnedPosts(store, 'alice', { limit: 1 })
  reads = 0
  await assert.rejects(listOwnedPosts(store, 'bob', { cursor: page.nextCursor }), { code: 'INVALID_INPUT' })
  await assert.rejects(listOwnedPosts(store, 'alice', { offset: 0 }), { code: 'INVALID_INPUT' })
  await assert.rejects(listOwnedPosts(store, 'alice', { limit: 51 }), { code: 'INVALID_INPUT' })
  assert.equal(reads, 0)
  await assert.rejects(listOwnedPosts(store, 'alice', { cursor: page.nextCursor }), /boundary/)
  await assert.rejects(listOwnedPosts({ ...store, list: async () => [{ ...row('a'), _openid: 'bob' }] }, 'alice', {}), /boundary/)
  assert.throws(() => parseOwnedPostPage({ ...page, nextCursor: null }), /boundary/)
  await assert.rejects(listOwnedPosts({ ...store, count: async () => { throw Error('offline') } }, 'alice', {}), /offline/)
})
