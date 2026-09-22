const assert = require('node:assert/strict')
const test = require('node:test')
const { readMessageHistory, InvalidHistoryRequest } = require('@lynku/server')
const conversation = { id: 'conversation', viewer: 'alice', peer: 'bob' }
const message = sequence => ({ _id: `m${sequence}`, msg_id: `request${sequence}`, from: 'bob', to: 'alice', content: 'hello',
  status: 'read', created_at: new Date('2026-09-21T01:00:00.000Z'), conversation_id: conversation.id, sync_sequence: sequence,
  request_fingerprint: 'private' })

test('history pages tied timestamps by sequence and bootstraps sync at newest message', async () => {
  const messages = Array.from({ length: 75 }, (_, i) => message(i + 1))
  const store = { async list(id, before, take) {
    assert.equal(id, conversation.id)
    assert.equal(take, 31)
    return messages.filter(m => before === undefined || m.sync_sequence < before).sort((a, b) => b.sync_sequence - a.sync_sequence).slice(0, take)
  } }
  const first = await readMessageHistory(store, conversation, {})
  assert.equal(first.sync_cursor.sequence, 75)
  assert.equal(first.nextBefore.sequence, 46)
  assert.equal(first.messages[0].sync_sequence, 46)
  messages.push(message(76))
  const seen = [...first.messages]
  let before = first.nextBefore
  while (before) {
    const page = await readMessageHistory(store, conversation, { before })
    seen.push(...page.messages)
    before = page.nextBefore
  }
  assert.equal(new Set(seen.map(m => m._id)).size, 75)
  assert.equal(seen.length, 75)
  assert.equal(seen.some(m => m.sync_sequence === 76), false)
  assert.equal(JSON.stringify(seen).includes('request_fingerprint'), false)
  const empty = await readMessageHistory({ list: async () => [] }, conversation, {})
  assert.equal(empty.sync_cursor.sequence, 0)
})

test('history rejects old protocols, wrong scopes and damaged records', async () => {
  let reads = 0
  const store = { list: async () => { reads++; return [] } }
  for (const request of [{ before: '2026-09-21T00:00:00.000Z' }, { after: '2026-09-21T00:00:00.000Z' },
    { before: { version: 2, conversation_id: 'other', sequence: 4 } }, { limit: 51 }]) {
    await assert.rejects(readMessageHistory(store, conversation, request), InvalidHistoryRequest)
  }
  assert.equal(reads, 0)
  for (const bad of [{ ...message(1), conversation_id: 'other' }, { ...message(1), from: 'mallory' },
    { ...message(1), anonymous_context: { thread_id: 'private' } }, { ...message(1), sync_sequence: undefined }]) {
    await assert.rejects(readMessageHistory({ list: async () => [bad] }, conversation, {}))
  }
  const anonymous = await readMessageHistory({ list: async () => [{ ...message(1), anonymous_context: { protocol_version: 3, thread_id: 'thread', initiator_visibility: 'anonymous', target_visibility: 'anonymous' } }] },
    { ...conversation, anonymousThread: 'thread', peerVisibility: 'anonymous' }, {})
  assert.equal(anonymous.messages[0].from, 'anonymous_peer')
  assert.equal(JSON.stringify(anonymous).includes('bob'), false)
})
