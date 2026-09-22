import test from 'node:test'
import assert from 'node:assert/strict'
import { projectAdminPost, readAdminPost, readAdminPosts, AdminPostInputFailure, AdminPostUnavailable } from '@lynku/server'
import { adminPostPrecedes } from '@lynku/contracts'
const post = { _id: 'post-999', title: 'Campus News', category_id: 'campus', anonymous: true, author: { nickname: 'Private Name', _openid: 'secret' }, _openid: 'secret', status: 'published', created_at: new Date('2026-09-22T00:00:00.000Z'), comment_count: 2, revision: 1 }
test('admin detail projects only allowed fields and refuses deleted or mismatched records', async () => {
  const stored = { ...post, content: '<script>literal text</script>', updated_at: post.created_at, private_note: 'secret-note' }
  const detail = await readAdminPost({ read: async () => stored }, { id: post._id })
  assert.equal(detail.content, stored.content)
  assert.equal(JSON.stringify(detail).includes('secret'), false)
  assert.equal(detail.authorLabel, '匿名内容')
  await assert.rejects(readAdminPost({ read: async () => ({ ...stored, status: 'deleted' }) }, { id: post._id }), AdminPostUnavailable)
  await assert.rejects(readAdminPost({ read: async () => null }, { id: post._id }), AdminPostUnavailable)
  await assert.rejects(readAdminPost({ read: async () => stored }, { id: 'different' }))
  let called = false
  await assert.rejects(readAdminPost({ read: async () => { called = true; return stored } }, { id: '' }), AdminPostInputFailure)
  assert.equal(called, false)
})
test('admin post projection hides anonymous identity and deleted titles; malformed anonymity fails closed', () => {
  const anonymous = projectAdminPost(post)
  assert.equal(anonymous.authorLabel, '匿名内容')
  assert.equal(JSON.stringify(anonymous).includes('Private'), false)
  assert.equal(JSON.stringify(anonymous).includes('secret'), false)
  const deleted = projectAdminPost({ ...post, status: 'deleted', anonymous: false })
  assert.equal(deleted.title, '已删除内容'); assert.equal(deleted.authorLabel, '不展示')
  assert.equal(JSON.stringify(deleted).includes('Campus News'), false)
  for (const anonymous of [undefined, 'true', 1, null]) assert.throws(() => projectAdminPost({ ...post, anonymous }))
})
test('admin posts page through same-time records and reject cross-filter cursors before querying', async () => {
  const rows = Array.from({ length: 57 }, (_, index) => ({ ...post, _id: `post-${999 - index}` }))
  const store = { list: async (query: Parameters<Parameters<typeof readAdminPosts>[0]['list']>[0], take: number) => rows.filter(item => !query.cursor || adminPostPrecedes(query.cursor, { id: item._id, createdAt: item.created_at.toISOString() })).slice(0, take) }
  let page = await readAdminPosts(store, { query: 'Campus', limit: 20 })
  const cursor = page.nextCursor, ids = page.items.map(item => item.id)
  while (page.nextCursor) {
    page = await readAdminPosts(store, { query: 'Campus', limit: 20, cursor: page.nextCursor })
    ids.push(...page.items.map(item => item.id))
  }
  assert.equal(ids.length, 57); assert.equal(new Set(ids).size, 57)
  let called = false
  await assert.rejects(readAdminPosts({ list: async () => { called = true; return [] } }, { query: 'Different', cursor }), AdminPostInputFailure)
  assert.equal(called, false)
})
test('admin post filters reject unexpected database scope and searching deleted original titles', async () => {
  await assert.rejects(readAdminPosts({ list: async () => [post] }, { status: 'hidden' }))
  await assert.rejects(readAdminPosts({ list: async () => [post] }, { query: 'No match' }))
  await assert.rejects(readAdminPosts({ list: async () => [] }, { status: 'deleted', query: 'Campus' }), AdminPostInputFailure)
})
