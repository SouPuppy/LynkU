const assert = require('node:assert/strict')
const test = require('node:test')
const { parseSelfProfile } = require('@lucky/contracts')
const { projectSelfProfile } = require('@lucky/server')
const profile = { _openid: 'alice', nickname: 'Alice', avatar_url: '', role: 'user', email: '', verified: false }
test('account projection preserves verification while stripping internal database fields', () => {
  const result = projectSelfProfile({ ...profile, verified: true, role: 'admin', email: 'fixture@nottingham.edu.cn',
    verified_at: new Date('2026-01-01T00:00:00.000Z'), _id: 'database-id', profile_revision: 50, secret: 'test-only' }, 'alice')
  assert.equal(result.verified_at, '2026-01-01T00:00:00.000Z')
  assert.equal(result.verified, true)
  assert.equal(result.role, 'admin')
  assert.equal(result.secret, undefined)
  assert.equal(result._id, undefined)
  assert.equal(result.profile_revision, undefined)
  assert.deepEqual(parseSelfProfile(JSON.parse(JSON.stringify(result))), result)
  assert.throws(() => projectSelfProfile(profile, 'bob'), /ownership/)
})
test('account schema rejects coercion, invalid dates and malformed identity', () => {
  for (const value of [null, [], { ...profile, verified: 'false' }, { ...profile, role: 'superuser' },
    { ...profile, _openid: '' }, { ...profile, verified_at: 'yesterday' }, { ...profile, email: 1 }]) {
    assert.throws(() => parseSelfProfile(value))
  }
})
