const assert = require('node:assert/strict')
const test = require('node:test')
const { projectComment } = require('@lucky/server')
const { parseCommentView, parseCommentSyncPage, parseCommentPage } = require('@lucky/contracts')
const row = { _id: 'comment', _openid: 'secret-owner', post_id: 'post', parent_id: null, depth: 0,
  content: 'hello', anonymous: true, status: 'published', created_at: new Date('2026-09-21T00:00:00Z'),
  author: { nickname: 'Private name', avatar_url: '/private', email: 'secret-mail' },
  request_fingerprint: 'secret-retry-key', future_identity: { owner: 'secret-owner' } }
test('comment public projection strips all private fields including nested future fields', () => {
  const result = projectComment(row, 'secret-owner')
  assert.equal(result.is_mine, true)
  assert.equal(result.created_at, row.created_at.toISOString())
  assert.equal(JSON.stringify(result).includes('secret'), false)
  const named = projectComment({ ...row, anonymous: false }, '')
  assert.equal(named._openid, row._openid)
  assert.deepEqual(named.author, { nickname: 'Private name', avatar_url: '/private' })
  assert.equal('request_fingerprint' in named, false)
  for (const status of ['deleted', 'flagged']) {
    const hidden = projectComment({ ...row, anonymous: false, status }, '')
    assert.equal(hidden.content, '')
    assert.equal('_openid' in hidden, false)
    assert.equal(JSON.stringify(hidden).includes('Private name'), false)
  }
})
test('malformed comment privacy state or identity fails closed', () => {
  for (const patch of [{ anonymous: 'false' }, { depth: 2 }, { _openid: '' }, { created_at: 'invalid' }, { status: 'unknown' }]) {
    assert.throws(() => projectComment({ ...row, ...patch }, ''))
  }
})
test('comment sync rejects scope errors, cursor jumps and malformed records before committing progress', () => {
  const after = { version: 1, post_id: 'post', sequence: 2 }
  const comment = projectComment(row, '')
  const change = { comment_id: comment._id, sequence: 3, type: 'created', comment }
  const page = { changes: [change], has_more: false, next_cursor: { ...after, sequence: 3 } }
  assert.equal(parseCommentSyncPage(page, after).nextCursor.sequence, 3)
  for (const bad of [
    { ...page, next_cursor: { ...after, sequence: 4 } },
    { ...page, changes: [change, change] },
    { ...page, changes: [{ ...change, comment: { ...comment, post_id: 'other' } }] },
    { ...page, changes: [{ ...change, comment_id: 'other' }] },
    { ...page, changes: [], has_more: true, next_cursor: after },
  ]) assert.throws(() => parseCommentSyncPage(bad, after))
  assert.throws(() => parseCommentPage({ comments: [comment, comment], total: 2, hasMore: false }, 'post'))
  assert.throws(() => parseCommentPage({ comments: [comment], total: 1, hasMore: false }, 'other'))
  assert.equal(JSON.stringify(parseCommentView({ ...comment, author: row.author, _openid: row._openid })).includes('secret'), false)
})
