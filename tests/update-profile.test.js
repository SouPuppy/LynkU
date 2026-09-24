const assert = require('node:assert/strict')
const test = require('node:test')
const { updateAccountProfile } = require('@lynku/server')
const { PRESET_AVATARS, ANONYMOUS_AVATAR } = require('@lynku/contracts')
const original = { _id: 'old-account', _openid: 'alice', nickname: 'Alice', avatar_url: '', role: 'admin',
  email: 'fixture@nottingham.edu.cn', verified: true, profile_version: 0 }
function fixture() {
  const state = { user: { ...original }, events: new Map(), failEnqueue: false }
  let tail = Promise.resolve()
  const store = {
    moderate: async () => ({ clean: true }),
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

test('all four account avatars save atomically and retries do not duplicate profile events', async () => {
  const { store, state } = fixture()
  for (const [index, avatar] of PRESET_AVATARS.entries()) {
    await updateAccountProfile(store, 'alice', { avatar_url: avatar.src })
    const again = await updateAccountProfile(store, 'alice', { avatar_url: avatar.src })
    assert.equal(state.user.avatar_url, avatar.src)
    assert.equal(state.user.profile_version, index + 1)
    assert.equal(state.events.size, index + 1)
    assert.equal(again.outboxId, null)
    assert.equal(again.user.verified, true)
    assert.equal(again.user.email, original.email)
  }
  state.failEnqueue = true
  await assert.rejects(updateAccountProfile(store, 'alice', { avatar_url: PRESET_AVATARS[0].src }), /outbox/)
  assert.equal(state.user.avatar_url, PRESET_AVATARS[3].src)
})

test('avatar writes reject anonymous, remote and temporary sources before any data access', async () => {
  const { store } = fixture()
  for (const avatar_url of [ANONYMOUS_AVATAR, '/assets/anonymous.png', '', 'https://example.com/a.png',
    'cloud://external/avatar.png', 'wxfile://tmp/a.png', '/assets/avatar/avatar_01.png', PRESET_AVATARS[0].src + '?id=secret']) {
    await assert.rejects(updateAccountProfile({ ...store, find: async () => { throw Error('must not read') } }, 'alice', { avatar_url }), { code: 'INVALID_INPUT' })
  }
})
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
