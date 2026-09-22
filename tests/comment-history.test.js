const test = require('node:test')
const assert = require('node:assert/strict')
const { readCommentHistory, readCommentChanges } = require('@lynku/server')
const comment = id => ({ _id: id, _openid: 'author', post_id: 'post', parent_id: null, depth: 0, content: 'Body', anonymous: true,
  status: 'published', created_at: '2026-09-21T00:00:00.000Z' })
test('comment snapshot records watermark before reading rows and uses stable history boundaries', async () => {
  const calls = []
  const store = { post: async () => ({ _id: 'post', status: 'published' }),
    counter: async () => { calls.push('watermark'); return { sequence: 100 } },
    history: async (_, cursor, take) => { calls.push('history'); assert.equal(take, 2); return cursor ? [comment('b')] : [comment('a'), comment('b')] },
    count: async () => 2 }
  const page = await readCommentHistory(store, '', { post_id: 'post', limit: 1 })
  assert.deepEqual(calls, ['watermark', 'history']); assert.equal(page.syncCursor.sequence, 100)
  assert.equal(page.nextCursor.id, 'a')
  const last = await readCommentHistory(store, '', { post_id: 'post', limit: 1, cursor: page.nextCursor })
  assert.equal(last.hasMore, false); assert.equal(last.items[0]._id, 'b')
  for (const request of [{ post_id: 'post', offset: 0 }, { post_id: 'other', cursor: page.nextCursor }]) {
    await assert.rejects(readCommentHistory(store, '', request), { code: 'INVALID_INPUT' })
  }
  await assert.rejects(readCommentHistory({ ...store, counter: async () => { throw Error('offline') } }, '', { post_id: 'post' }), /offline/)
})
test('comment sync requires contiguous scoped events and redacts deleted body in replay', async () => {
  const input = { post_id: 'post', cursor: { version: 1, post_id: 'post', sequence: 10 }, limit: 1 }
  const store = { post: async () => ({ _id: 'post', status: 'published' }),
    changes: async () => [{ post_id: 'post', comment_id: 'a', sequence: 11, type: 'deleted' }],
    comment: async () => ({ ...comment('a'), status: 'deleted' }) }
  const result = await readCommentChanges(store, 'author', input)
  assert.equal(result.changes[0].comment.content, ''); assert.equal(result.next_cursor.sequence, 11)
  await assert.rejects(readCommentChanges({ ...store, changes: async () => [{ post_id: 'post', comment_id: 'a', sequence: 12, type: 'created' }] }, '', input), /stream/)
  await assert.rejects(readCommentChanges({ ...store, comment: async () => ({ ...comment('a'), post_id: 'other' }) }, '', input), /scope/)
})
