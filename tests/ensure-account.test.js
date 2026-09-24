const assert = require('node:assert/strict')
const test = require('node:test')
const { ensureAccount } = require('@lynku/server')
const existing = { _id: 'old-id', _openid: 'alice', nickname: 'Existing', avatar_url: '', role: 'admin', email: 'fixture@nottingham.edu.cn', verified: true }
test('automatic account identification preserves old records and never creates after read failure', async () => {
  let writes = 0
  const store = { find: async () => existing, createIfAbsent: async () => { writes++; throw Error('unexpected creation') },
    identifier: owner => owner, now: () => '2026-09-21T00:00:00.000Z' }
  const result = await ensureAccount(store, 'alice')
  assert.equal(result.verified, true)
  assert.equal(result.nickname, 'Existing')
  assert.equal(result.role, 'admin')
  await assert.rejects(ensureAccount({ ...store, find: async () => { throw Error('read unavailable') } }, 'alice'), /read unavailable/)
  await assert.rejects(ensureAccount({ ...store, find: async () => ({ ...existing, verified: 'true' }) }, 'alice'))
  assert.equal(writes, 0)
})
test('new account defaults are unverified and the confirmed record owns the response', async () => {
  let created
  const store = { find: async () => null, identifier: owner => `account-${owner}`, now: () => '2026-09-21T00:00:00.000Z',
    createIfAbsent: async account => { created = account; return account } }
  const result = await ensureAccount(store, 'alice')
  assert.equal(created._id, 'account-alice')
  assert.equal(result.verified, false)
  assert.equal(result.role, 'user')
  assert.equal(result.nickname, '微信用户')
  assert.equal(result.avatar_url, require('@lynku/contracts').DEFAULT_AVATAR)
  const raced = await ensureAccount({ ...store, createIfAbsent: async () => existing }, 'alice')
  assert.equal(raced.verified, true)
  await assert.rejects(ensureAccount({ ...store, createIfAbsent: async () => ({ ...existing, _openid: 'bob' }) }, 'alice'), /ownership/)
})
