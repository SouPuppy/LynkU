const assert = require('node:assert/strict')
const test = require('node:test')
const { markMessagesRead, InvalidReadRequest } = require('@lucky/server')
const conversation = { id: 'conversation', viewer: 'alice', peer: 'bob' }
function fixture() {
  let state = { messages: [1, 2].map(sequence => ({ _id: `m${sequence}`, msg_id: `r${sequence}`, from: 'bob', to: 'alice',
    content: 'hello', status: 'sent', created_at: '2026-09-21T01:00:00.000Z', conversation_id: 'conversation', sync_sequence: sequence })),
    directory: { owner_openid: 'alice', conversation_id: 'conversation', unread_count: 2, updated_at: 'activity-time', last_message: { _id: 'm2', status: 'sent' } } }
  let fail = false
  let queue = Promise.resolve()
  const store = { run(operation) {
    const task = queue.then(async () => {
      const pending = structuredClone(state)
      const result = await operation({
        message: async id => pending.messages.find(m => m._id === id),
        directory: async () => pending.directory,
        setMessageRead: async id => { pending.messages.find(m => m._id === id).status = 'read' },
        setDirectoryUnread: async (count, lastRead) => {
          if (fail) throw new Error('directory write failed')
          pending.directory.unread_count = count
          if (lastRead) pending.directory.last_message.status = 'read'
        },
      })
      state = pending
      return result
    })
    queue = task.catch(() => {})
    return task
  } }
  return { store, state: () => state, fail: value => { fail = value } }
}

test('read facts and unread projection roll back together then retry idempotently', async () => {
  const f = fixture()
  f.fail(true)
  await assert.rejects(markMessagesRead(f.store, conversation, ['m1', 'm2']))
  assert.equal(f.state().directory.unread_count, 2)
  assert.equal(f.state().messages[0].status, 'sent')
  f.fail(false)
  const results = await Promise.all([
    markMessagesRead(f.store, conversation, ['m1', 'm1', 'm2']),
    markMessagesRead(f.store, conversation, ['m1', 'm2']),
  ])
  assert.deepEqual(results, [2, 0])
  assert.equal(f.state().directory.unread_count, 0)
  assert.equal(f.state().directory.last_message.status, 'read')
  assert.equal(f.state().directory.updated_at, 'activity-time')
})

test('read requests cannot mark sent messages or operate without explicit bounded IDs', async () => {
  const f = fixture()
  for (const ids of [undefined, [], Array.from({ length: 21 }, (_, i) => `m${i}`)]) {
    await assert.rejects(markMessagesRead(f.store, conversation, ids), InvalidReadRequest)
  }
  f.state().messages[1].from = 'alice'
  f.state().messages[1].to = 'bob'
  await assert.rejects(markMessagesRead(f.store, conversation, ['m1', 'm2']), InvalidReadRequest)
  assert.equal(f.state().messages[0].status, 'sent')
  assert.equal(f.state().directory.unread_count, 2)
  f.state().messages[1].from = 'bob'
  f.state().messages[1].to = 'alice'
  f.state().directory.unread_count = 0
  await assert.rejects(markMessagesRead(f.store, conversation, ['m1']))
  assert.equal(f.state().messages[0].status, 'sent')
})

test('read receipt application returns only requested outgoing read IDs', async () => {
  const { readReceipts, InvalidReceiptRequest } = require('@lucky/server')
  const message = { _id: 'sent', msg_id: 'request', from: 'alice', to: 'bob', content: 'private', status: 'read',
    created_at: '2026-09-21T01:00:00.000Z', conversation_id: 'conversation', sync_sequence: 1 }
  const store = { list: async (id, sender, ids) => {
    assert.equal(id, 'conversation'); assert.equal(sender, 'alice'); assert.deepEqual(ids, ['sent'])
    return [message]
  } }
  assert.deepEqual(await readReceipts(store, conversation, ['sent']), ['sent'])
  await assert.rejects(readReceipts(store, conversation, []), InvalidReceiptRequest)
  for (const invalid of [{ ...message, from: 'bob', to: 'alice' }, { ...message, _id: 'unrequested' },
    { ...message, status: 'sent' }, { ...message, conversation_id: 'other' }]) {
    await assert.rejects(readReceipts({ list: async () => [invalid] }, conversation, ['sent']))
  }
})
