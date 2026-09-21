const assert = require('node:assert/strict')
const test = require('node:test')
const { listConversationDirectory, InvalidDirectoryRequest } = require('@lucky/server')
const principal = { ownerId: 'alice', scope: 'a'.repeat(64) }
const context = { source_type: 'post', source_id: 'post-id', initiator_openid: 'alice', target_openid: 'bob', thread_id: 'b'.repeat(64) }
function row(overrides = {}) {
  return { _id: 'c'.repeat(64), owner_openid: 'alice', peer_openid: 'bob', updated_at: new Date('2026-09-21T01:00:00.000Z'),
    anonymous_context: null, unread_count: 3, last_message: { _id: 'message-id', from: 'bob', to: 'alice', content: 'hello', created_at: new Date('2026-09-21T01:00:00.000Z') }, ...overrides }
}

test('directory application exposes only public summaries and does not fetch anonymous profiles', async () => {
  let profileReads = 0
  for (const ownerId of ['alice', 'bob']) {
    const response = await listConversationDirectory({
      async list(owner, cursor, take) {
        assert.equal(owner, ownerId)
        assert.equal(cursor, undefined)
        assert.equal(take, 21)
        return [row({ owner_openid: ownerId, peer_openid: ownerId === 'alice' ? 'bob' : 'alice', anonymous_context: context })]
      },
      async profiles() { profileReads++; throw new Error('Private profile read') },
    }, { ...principal, ownerId }, { ownerId: 'mallory' })
    assert.equal(response.conversations[0].chat_target.thread_id, context.thread_id)
    assert.equal(response.conversations[0].peer._openid, undefined)
    assert.equal(JSON.stringify(response).includes('alice'), false)
    assert.equal(JSON.stringify(response).includes('bob'), false)
  }
  assert.equal(profileReads, 0)
  const direct = await listConversationDirectory({
    list: async () => [row()],
    profiles: async ids => {
      assert.deepEqual(ids, ['bob'])
      return [{ _openid: 'bob', nickname: 'Bob', avatar_url: '', email: 'private', role: 'admin' }]
    },
  }, principal, {})
  assert.deepEqual(direct.conversations[0].peer, { _openid: 'bob', nickname: 'Bob', avatar_url: '' })
  assert.deepEqual(Object.keys(direct.conversations[0].lastMessage).sort(), ['_id', 'content', 'created_at'])
})

test('directory application fails closed on corrupt ownership and anonymous metadata', async () => {
  for (const bad of [row({ owner_openid: 'mallory' }), row({ anonymous_context: false }),
    row({ anonymous_context: { ...context, target_openid: 'mallory' } }),
    row({ last_message: { ...row().last_message, anonymous_context: context } }),
    row({ anonymous_context: { ...context, thread_id: 'invalid' } }),
    row({ unread_count: -1 }), row({ updated_at: null })]) {
    await assert.rejects(listConversationDirectory({ list: async () => [bad], profiles: async () => [] }, principal, {}))
  }
  let reads = 0
  const store = { list: async () => { reads++; return [] }, profiles: async () => { throw new Error('Unexpected profiles') } }
  await assert.rejects(listConversationDirectory(store, principal, { cursor: { version: 1, scope: 'd'.repeat(64), id: 'e'.repeat(64), updatedAt: '2026-09-21T01:00:00.000Z' } }), InvalidDirectoryRequest)
  assert.equal(reads, 0)
})
