const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { resolveConversationTarget, InvalidConversationTarget, ConversationTargetNotFound } = require('@lucky/server')
const hash = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex')
const context = { source_type: 'post', source_id: 'post', initiator_openid: 'alice', target_openid: 'bob',
  thread_id: hash('anonymous_chat', 'post', 'post', 'alice', 'bob') }
const conversationId = hash('conversation', 'anonymous', context.thread_id)
const target = { type: 'post', id: 'post', thread_id: context.thread_id }

test('anonymous channels are keyed by discovery source and visitor, never by the real person alone', async () => {
  const store = { identifier: hash, directory: async () => null,
    source: async (type, id) => ({ _id: id, _openid: 'bob-user', status: 'published', anonymous: true, post_id: 'parent' }) }
  const resolve = (owner, type, id) => resolveConversationTarget(store, owner, { anonymous_target: { type, id } })
  const first = await resolve('alice', 'post', 'source-a')
  const repeated = await resolve('alice', 'post', 'source-a')
  const second = await resolve('alice', 'post', 'source-b')
  const comment = await resolve('alice', 'comment', 'source-a')
  const anotherVisitor = await resolve('charlie', 'post', 'source-a')
  assert.equal(first.anonymousContext.thread_id, repeated.anonymousContext.thread_id)
  const channels = [first, second, comment, anotherVisitor].map(result => {
    assert.equal(result.peer, 'bob-user')
    return hash('conversation', 'anonymous', result.anonymousContext.thread_id)
  })
  assert.equal(new Set(channels).size, 4)
  assert.ok(channels.every(id => id !== hash('conversation', 'direct', 'alice', 'bob-user')))
  await assert.rejects(resolveConversationTarget(store, 'alice', { anonymous_target: {
    type: 'post', id: 'source-b', thread_id: first.anonymousContext.thread_id,
  } }), ConversationTargetNotFound)
})

test('existing anonymous threads survive deleted sources and remain participant-scoped', async () => {
  for (const owner of ['alice', 'bob']) {
    const result = await resolveConversationTarget({ identifier: hash,
      source: async () => { throw new Error('Existing thread must not need a visible source') },
      directory: async (caller, id) => {
        assert.equal(caller, owner); assert.equal(id, conversationId)
        return { owner_openid: owner, peer_openid: owner === 'alice' ? 'bob' : 'alice', conversation_id: conversationId, anonymous_context: context }
      },
    }, owner, { anonymous_target: target })
    assert.equal(result.peer, owner === 'alice' ? 'bob' : 'alice')
    assert.equal(result.anonymousContext.thread_id, context.thread_id)
  }
  const foreign = { identifier: hash, source: async () => null, directory: async () => ({
    owner_openid: 'mallory', peer_openid: 'bob', conversation_id: conversationId, anonymous_context: context,
  }) }
  await assert.rejects(resolveConversationTarget(foreign, 'mallory', { anonymous_target: target }), ConversationTargetNotFound)
  await assert.rejects(resolveConversationTarget({ ...foreign, directory: async () => null }, 'mallory', { anonymous_target: target }), ConversationTargetNotFound)
})

test('new anonymous threads need published anonymous sources and reject forged thread IDs', async () => {
  const store = { identifier: hash, directory: async () => null, source: async () => ({ _id: 'post', _openid: 'bob', status: 'published', anonymous: true }) }
  const resolved = await resolveConversationTarget(store, 'alice', { anonymous_target: { type: 'post', id: 'post' } })
  assert.deepEqual(resolved.anonymousContext, context)
  assert.equal((await resolveConversationTarget(store, 'alice', { anonymous_target: target })).peer, 'bob')
  await assert.rejects(resolveConversationTarget(store, 'alice', { anonymous_target: { ...target, thread_id: 'f'.repeat(64) } }), ConversationTargetNotFound)
  for (const source of [null, { _id: 'post', _openid: 'bob', status: 'deleted', anonymous: true },
    { _id: 'post', _openid: 'bob', status: 'published', anonymous: false }]) {
    await assert.rejects(resolveConversationTarget({ ...store, source: async () => source }, 'alice', { anonymous_target: { type: 'post', id: 'post' } }), ConversationTargetNotFound)
  }
  await assert.rejects(resolveConversationTarget({ ...store, source: async type => type === 'comment'
    ? { _id: 'comment', post_id: 'post', _openid: 'bob', status: 'published', anonymous: true }
    : { _id: 'post', status: 'flagged' } }, 'alice', { anonymous_target: { type: 'comment', id: 'comment' } }), ConversationTargetNotFound)
})

test('ambiguous or old target protocols fail before storage and query faults stay faults', async () => {
  let reads = 0
  const store = { identifier: hash, directory: async () => { reads++; return null }, source: async () => { reads++; throw new Error('database offline') } }
  for (const input of [{ anonymousTarget: target }, { anonymous_target: null }, { peer: 'bob-user', anonymous_target: target },
    { peer: 'bob-user', to: 'bob-user' }, { anonymous_target: { ...target, thread_id: 'short' } }]) {
    await assert.rejects(resolveConversationTarget(store, 'alice', input), InvalidConversationTarget)
  }
  assert.equal(reads, 0)
  await assert.rejects(resolveConversationTarget(store, 'alice', { anonymous_target: { type: 'post', id: 'post' } }), /database offline/)
})
