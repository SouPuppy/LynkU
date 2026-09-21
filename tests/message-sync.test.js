const assert = require('node:assert/strict')
const test = require('node:test')
const { syncMessages, InvalidMessageSyncRequest } = require('@lucky/server')
const conversation = { id: 'conversation', viewer: 'alice', peer: 'bob', anonymousThread: 'thread' }
const cursor = { version: 2, conversation_id: 'conversation', sequence: 3 }
const message = { _id: 'm4', msg_id: 'request4', from: 'bob', to: 'alice', content: 'hello', status: 'sent',
  created_at: new Date('2026-09-21T01:00:00.000Z'), conversation_id: 'conversation', sync_sequence: 4,
  request_fingerprint: 'private', anonymous_context: { thread_id: 'thread' } }

test('sync application validates records and shares the private-safe history projection', async () => {
  const result = await syncMessages({ list: async (id, after, take) => {
    assert.equal(id, conversation.id); assert.equal(after, 3); assert.equal(take, 51)
    return [message]
  } }, conversation, { cursor })
  assert.equal(result.messages[0].from, 'anonymous_peer')
  assert.equal(result.nextCursor.sequence, 4)
  assert.equal(JSON.stringify(result).includes('bob'), false)
  assert.equal(result.messages[0].request_fingerprint, undefined)
  for (const damaged of [{ ...message, sync_sequence: 3 }, { ...message, to: 'mallory' },
    { ...message, anonymous_context: { thread_id: 'another-thread' } }]) {
    await assert.rejects(syncMessages({ list: async () => [damaged] }, conversation, { cursor }))
  }
  const empty = await syncMessages({ list: async () => [] }, conversation, { cursor })
  assert.equal(empty.nextCursor.sequence, 3)
})

test('sync application rejects invalid requests before reading storage', async () => {
  let reads = 0
  for (const input of [{ cursor, since: 'old' }, { cursor, limit: 51 }, { cursor: { ...cursor, conversation_id: 'other' } }]) {
    await assert.rejects(syncMessages({ list: async () => { reads++; return [] } }, conversation, input), InvalidMessageSyncRequest)
  }
  assert.equal(reads, 0)
})
