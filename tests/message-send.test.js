const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { sendNewMessage, MessageIdConflict } = require('@lynku/server')
const conversation = { id: 'conversation', viewer: 'alice', peer: 'bob' }
function fixture() {
  let state = { messages: new Map(), counter: null, directories: new Map() }
  let queue = Promise.resolve(), failure = false, rateCalls = 0
  const store = {
    existing: async id => state.messages.get(id) || null,
    moderate: async () => ({ clean: true }),
    authorizeRecipientAndRate: async () => { rateCalls++ },
    identifier: (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex'),
    timestamp: () => new Date('2026-09-21T01:00:00.000Z'),
    run(id, operation) {
      const task = queue.then(async () => {
        const pending = structuredClone(state)
        let writing = false
        const read = value => { assert.equal(writing, false, 'all reads must precede writes'); return value }
        const result = await operation({
          existing: async () => read(pending.messages.get(id) || null),
          counter: async () => read(pending.counter),
          directory: async owner => read(pending.directories.get(owner) || null),
          writeCounter: async sequence => { writing = true; pending.counter = { last_sequence: sequence } },
          writeMessage: async message => { writing = true; pending.messages.set(id, message) },
          writeDirectory: async (owner, entry) => {
            writing = true
            if (failure && owner === 'bob') throw new Error('directory write failed')
            pending.directories.set(owner, entry)
          },
        })
        state = pending
        return result
      })
      queue = task.catch(() => {})
      return task
    },
  }
  return { store, state: () => state, fail: value => { failure = value }, rates: () => rateCalls }
}

test('send transaction rolls back all four records and concurrent retries create one message', async () => {
  const f = fixture()
  const request = { content: ' hello ', msg_id: 'request1' }
  f.fail(true)
  await assert.rejects(sendNewMessage(f.store, conversation, null, request), /directory write failed/)
  assert.equal(f.state().messages.size, 0)
  assert.equal(f.state().counter, null)
  assert.equal(f.state().directories.size, 0)
  f.fail(false)
  const replies = await Promise.all([sendNewMessage(f.store, conversation, null, request), sendNewMessage(f.store, conversation, null, request)])
  assert.deepEqual(replies.map(r => r.status).sort(), ['duplicate', 'sent'])
  assert.equal(f.state().messages.size, 1)
  assert.equal(f.state().counter.last_sequence, 1)
  assert.equal(f.state().directories.get('alice').unread_count, 0)
  assert.equal(f.state().directories.get('bob').unread_count, 1)
  assert.equal(replies[0].message.content, 'hello')
  assert.equal(replies[0].message.request_fingerprint, undefined)
  const rates = f.rates()
  await assert.rejects(sendNewMessage(f.store, conversation, null, { ...request, content: 'changed' }), MessageIdConflict)
  assert.equal(f.rates(), rates)
})

test('send read faults and damaged sequence state never create or overwrite records', async () => {
  const f = fixture()
  const original = f.store.existing
  f.store.existing = async () => { throw new Error('database unavailable') }
  await assert.rejects(sendNewMessage(f.store, conversation, null, { msg_id: 'one', content: 'hello' }), /database unavailable/)
  assert.equal(f.rates(), 0)
  assert.equal(f.state().messages.size, 0)
  f.store.existing = original
  await sendNewMessage(f.store, conversation, null, { msg_id: 'one', content: 'hello' })
  f.state().counter = null
  await assert.rejects(sendNewMessage(f.store, conversation, null, { msg_id: 'two', content: 'hello' }), /Incomplete conversation/)
  assert.equal(f.state().messages.size, 1)
})

test('message safety rejection happens before rate limiting or transaction writes', async () => {
  const f = fixture()
  f.store.moderate = async () => { const error = new Error('unsafe'); error.code = 'CONTENT_REJECTED'; throw error }
  await assert.rejects(sendNewMessage(f.store, conversation, null, { msg_id: 'unsafe', content: 'unsafe' }), { code: 'CONTENT_REJECTED' })
  assert.equal(f.rates(), 0)
  assert.equal(f.state().messages.size, 0)
  assert.equal(f.state().counter, null)
})

test('send can confirm an ambiguous committed write by retrying the same request ID', async () => {
  const f = fixture()
  const original = f.store.existing
  let reads = 0
  f.store.existing = async id => {
    if (++reads === 2) throw new Error('confirmation lost')
    return original(id)
  }
  const request = { msg_id: 'one', content: 'hello' }
  await assert.rejects(sendNewMessage(f.store, conversation, null, request), /confirmation lost/)
  assert.equal(f.state().messages.size, 1)
  const retried = await sendNewMessage(f.store, conversation, null, request)
  assert.equal(retried.status, 'duplicate')
  assert.equal(f.state().counter.last_sequence, 1)
  assert.equal(f.state().directories.get('bob').unread_count, 1)
})
