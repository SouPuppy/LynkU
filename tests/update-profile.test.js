const assert = require('node:assert/strict')
const test = require('node:test')
const { updateAccountProfile } = require('@lucky/server')
const original = { _id: 'old-account', _openid: 'alice', nickname: 'Alice', avatar_url: '', role: 'admin',
  email: 'fixture@nottingham.edu.cn', verified: true, profile_version: 0 }
function fixture() {
  const state = { user: { ...original }, events: new Map(), failEnqueue: false }
  let tail = Promise.resolve()
  const store = {
    find: async () => state.user,
    identifier: (owner, version) => `${owner}-${version}`,
    now: () => '2026-09-21T00:00:00.000Z',
    run(work) {
      const promise = tail.then(async () => {
        let user = { ...state.user }
        const events = new Map(state.events)
        const result = await work({
          read: async id => { assert.equal(id, original._id); return user },
          update: async (id, fields) => { assert.equal(id, original._id); user = { ...user, ...fields } },
          enqueue: async (id, event) => { if (state.failEnqueue) throw Error('outbox offline'); events.set(id, event) },
        })
        state.user = user; state.events = events
        return result
      })
      tail = promise.catch(() => {})
      return promise
    },
  }
  return { store, state }
}
test('profile and projection event roll back together; concurrent equal edits create one event', async () => {
  const { store, state } = fixture()
  state.failEnqueue = true
  await assert.rejects(updateAccountProfile(store, 'alice', { nickname: 'New' }), /outbox offline/)
  assert.deepEqual(state.user, original)
  assert.equal(state.events.size, 0)
  state.failEnqueue = false
  const results = await Promise.all([updateAccountProfile(store, 'alice', { nickname: ' New ' }), updateAccountProfile(store, 'alice', { nickname: 'New' })])
  assert.equal(state.user.nickname, 'New')
  assert.equal(state.user.profile_version, 1)
  assert.equal(state.events.size, 1)
  assert.equal(results.filter(result => result.outboxId === null).length, 1)
  assert.equal(results.every(result => result.user.verified && result.user.role === 'admin'), true)
})
test('profile updates reject invalid fields, wrong owners, corrupt versions and query failures', async () => {
  const { store, state } = fixture()
  for (const input of [{}, { nickname: '' }, { nickname: 12 }, { avatar_url: false }]) {
    await assert.rejects(updateAccountProfile({ ...store, find: async () => { throw Error('must not read') } }, 'alice', input), { code: 'INVALID_INPUT' })
  }
  await assert.rejects(updateAccountProfile(store, 'bob', { nickname: 'New' }), { code: 'FORBIDDEN' })
  state.user.profile_version = '1'
  await assert.rejects(updateAccountProfile(store, 'alice', { nickname: 'New' }), /version/)
  assert.equal(state.events.size, 0)
  await assert.rejects(updateAccountProfile({ ...store, find: async () => { throw Error('query failed') } }, 'alice', { nickname: 'New' }), /query failed/)
})
