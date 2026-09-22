const test = require('node:test')
const assert = require('node:assert/strict')
const { CommentThreadController } = require('../apps/miniprogram/features/content/index.ts')
const tick = () => new Promise(resolve => setImmediate(resolve))
const cursor = sequence => ({ version: 1, post_id: 'post', sequence })
const comment = (id, parent = null) => ({ _id: id, post_id: 'post', parent_id: parent, depth: parent ? 1 : 0,
  anonymous: true, is_mine: false, content: 'Visible', author: { nickname: '匿名用户', avatar_url: '' }, status: 'published',
  created_at: '2026-09-21T00:00:00.000Z' })
test('comment history handoff starts at watermark, keeps orphan replies and does not overwrite live deletions', async () => {
  let state, resolveHistory, calls = 0
  const seen = []
  const controller = new CommentThreadController({ revision: () => 0, subscribe: () => () => {} }, {
    history: async (_, after) => after ? new Promise(resolve => { resolveHistory = resolve }) : {
      items: [comment('a')], total: 2, hasMore: true, nextCursor: { version: 2, post_id: 'post', created_at: comment('a').created_at, id: 'a' }, syncCursor: cursor(80),
    },
    changes: async (_, after) => {
      seen.push(after.sequence)
      if (calls++ === 0) return { changes: [], nextCursor: after, hasMore: false }
      return { changes: [
        { comment_id: 'b', sequence: 81, type: 'deleted', comment: { ...comment('b'), status: 'deleted', content: '' } },
        { comment_id: 'r', sequence: 82, type: 'created', comment: comment('r', 'b') },
      ], nextCursor: cursor(82), hasMore: false }
    }, repeat: () => () => {},
  }, next => { state = next })
  await controller.refresh('post'); await tick()
  const more = controller.more()
  await controller.poll()
  resolveHistory({ items: [comment('b')], total: 2, hasMore: false, nextCursor: null, syncCursor: cursor(82) })
  await more
  assert.deepEqual(seen, [80, 80])
  assert.equal(state.comments[1].status, 'deleted'); assert.equal(state.comments[1].content, '')
  assert.equal(state.comments[1].replies[0]._id, 'r'); assert.equal(state.hasMore, false)
  controller.dispose()
})
test('comment lifecycle stops polling and prevents a late snapshot from restoring a private view', async () => {
  let resolve, state, listener, revision = 0, stops = 0
  const controller = new CommentThreadController({ revision: () => revision, subscribe: fn => { listener = fn; return () => { listener = null } } }, {
    history: () => new Promise(done => { resolve = done }), changes: async (_, after) => ({ changes: [], nextCursor: after, hasMore: false }),
    repeat: () => () => { stops++ },
  }, next => { state = next })
  const pending = controller.refresh('post')
  controller.hide(); revision++; listener()
  resolve({ items: [comment('private')], total: 1, hasMore: false, nextCursor: null, syncCursor: cursor(4) })
  await pending
  assert.equal(state.comments.length, 0); assert.equal(stops, 0)
  controller.dispose(); assert.equal(listener, null)
})
