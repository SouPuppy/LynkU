const assert = require('node:assert/strict')
const test = require('node:test')

const {
  advanceMessageCursor,
  assertMessageCursorScope,
  createMessageCursor,
} = require('../packages/server/dist/messaging/domain/cursor.js')
const {
  decodeSyncCursor,
  encodeSyncCursor,
} = require('../packages/server/dist/messaging/application/sync-cursor.js')

test('message cursor is scoped, monotonic, and serializable through the contract boundary', () => {
  const cursor = createMessageCursor('conversation-1')
  assert.deepEqual(cursor, { version: 2, conversationId: 'conversation-1', sequence: 0 })
  assert.deepEqual(advanceMessageCursor(cursor, 8), { version: 2, conversationId: 'conversation-1', sequence: 8 })
  assert.throws(() => advanceMessageCursor(cursor, -1), /cannot move a cursor backwards/)
  assert.throws(() => assertMessageCursorScope(cursor, 'conversation-2'), /does not belong/)

  const decoded = decodeSyncCursor({ version: 2, conversation_id: 'conversation-1', sequence: 4 }, 'conversation-1')
  assert.deepEqual(encodeSyncCursor(decoded, 9), { version: 2, conversation_id: 'conversation-1', sequence: 9 })
})

test('message cursor rejects invalid sequence and wrong conversation before a query can run', () => {
  assert.throws(() => createMessageCursor('', 0), /conversationId is required/)
  assert.throws(() => createMessageCursor('conversation-1', 1.5), /non-negative integer/)
  assert.throws(
    () => decodeSyncCursor({ version: 2, conversation_id: 'conversation-2', sequence: 0 }, 'conversation-1'),
    /does not belong/,
  )
})

test('comment change cursor is post-scoped and monotonic', () => {
  const {
    createCommentChangeCursor,
    advanceCommentChangeCursor,
    assertCommentChangeCursorScope,
  } = require('../packages/server/dist/comments/domain/cursor.js')
  const { decodeCommentSyncCursor } = require('../packages/server/dist/comments/application/sync-cursor.js')
  const cursor = createCommentChangeCursor('post-1')
  assert.deepEqual(cursor, { version: 1, postId: 'post-1', sequence: 0 })
  assert.deepEqual(advanceCommentChangeCursor(cursor, 3), { version: 1, postId: 'post-1', sequence: 3 })
  assert.throws(() => advanceCommentChangeCursor(cursor, -1), /cannot move a cursor backwards/)
  assert.throws(() => assertCommentChangeCursorScope(cursor, 'post-2'), /does not belong/)
  assert.throws(
    () => decodeCommentSyncCursor({ version: 1, post_id: 'post-2', sequence: 0 }, 'post-1'),
    /does not belong/,
  )
})

test('draft revision contract rejects stale writers and advances valid revisions', () => {
  const { assertDraftRevision } = require('../packages/server/dist/drafts/domain/revision.js')
  assert.equal(assertDraftRevision(3, 3), 4)
  assert.equal(assertDraftRevision(3, undefined), 4)
  assert.throws(() => assertDraftRevision(3, 2), /conflict/)
  assert.throws(() => assertDraftRevision(0, 0), /positive integer/)
})
