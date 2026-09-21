const assert = require('node:assert/strict')
const test = require('node:test')
const { projectPost } = require('@lucky/server')
const { parsePostView, parsePostPage } = require('@lucky/contracts')
const row = { _id: 'post', _openid: 'secret-owner', title: 'Title', content: 'Body', category_id: 'category',
  category: { _id: 'category', name: 'Campus', secret: 'hidden' }, anonymous: true, status: 'published',
  author: { _openid: 'secret-owner', nickname: 'Real name', avatar_url: '/real', email: 'secret-email' },
  view_count: 1, comment_count: 2, revision: 3, created_at: new Date('2026-09-21T00:00:00.000Z'), updated_at: new Date('2026-09-21T00:00:00.000Z'),
  last_update_fingerprint: 'secret-fingerprint', future_private_field: 'secret-internal' }
test('post DTO projection strips nested private fields and normalizes dates without losing ownership state', () => {
  const publicView = projectPost(row, '')
  assert.equal(publicView.is_mine, false)
  assert.equal(publicView.created_at, row.created_at.toISOString())
  assert.ok(!JSON.stringify(publicView).includes('secret'))
  assert.equal(projectPost(row, 'secret-owner').is_mine, true)
  const named = projectPost({ ...row, anonymous: false }, '')
  assert.equal(named._openid, 'secret-owner')
  assert.equal('email' in named.author, false)
  assert.equal('last_update_fingerprint' in named, false)
  assert.equal(parsePostView({ ...publicView, _openid: 'injected', author: row.author }).author.nickname, '匿名用户')
})
test('post DTO rejects malformed records, foreign category snapshots and invalid pages', () => {
  const view = projectPost(row, '')
  for (const bad of [{ ...view, revision: 0 }, { ...view, view_count: -1 }, { ...view, anonymous: 'true' },
    { ...view, updated_at: 'yesterday' }, { ...view, category: { _id: 'another', name: 'Another' } }]) {
    assert.throws(() => parsePostView(bad))
  }
  assert.throws(() => parsePostPage({ items: [view, view], total: 2, hasMore: false }))
  assert.throws(() => parsePostPage({ items: [{ ...view, status: 'flagged' }], total: 1, hasMore: false }))
  assert.equal(parsePostPage({ items: [view], total: 1, hasMore: false }).items.length, 1)
})
