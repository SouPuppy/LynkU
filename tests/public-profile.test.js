const assert = require('node:assert/strict')
const test = require('node:test')
const { readPublicProfile } = require('@lynku/server')
const { parsePublicProfileResponse } = require('@lynku/contracts')
const user = { _openid: 'alice', nickname: 'Alice', avatar_url: '', created_at: new Date('2026-01-01T00:00:00.000Z'),
  email: 'fixture@nottingham.edu.cn', verified: true, role: 'admin', _id: 'private-id' }
test('public profile maps explicit fields and rejects wrong identity or invalid request before querying', async () => {
  let calls = 0
  const find = async () => { calls++; return user }
  for (const id of [null, {}, '', ' alice', 'x'.repeat(129)]) await assert.rejects(readPublicProfile(find, id), { code: 'INVALID_INPUT' })
  assert.equal(calls, 0)
  const profile = await readPublicProfile(find, 'alice')
  assert.deepEqual(Object.keys(profile).sort(), ['_openid', 'avatar_url', 'created_at', 'nickname'])
  assert.equal(profile.created_at, user.created_at.toISOString())
  assert.throws(() => parsePublicProfileResponse({ profile }, 'bob'), /mismatch/)
  await assert.rejects(readPublicProfile(find, 'bob'), /mismatch/)
})
test('public profile absence is distinct from storage failures and malformed data', async () => {
  assert.equal(await readPublicProfile(async () => null, 'alice'), null)
  await assert.rejects(readPublicProfile(async () => { throw Error('database unavailable') }, 'alice'), /unavailable/)
  await assert.rejects(readPublicProfile(async () => ({ ...user, nickname: 123 }), 'alice'))
  assert.throws(() => parsePublicProfileResponse({}, 'alice'), /Missing/)
})
