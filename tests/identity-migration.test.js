const assert = require('node:assert/strict')
const test = require('node:test')
const { planIdentityMigration, compareIdentitySnapshot } = require('../scripts/plan-identity-migration')
const { stableDocumentId } = require('../apps/cloudfunctions/common')
const base = { _id: 'original', _openid: 'alice', nickname: 'Alice', avatar_url: '', role: 'user' }
test('identity migration keeps the verified account and retains every duplicate for archival', () => {
  const verified = { ...base, _id: 'verified-original', verified: true, email: 'fixture@nottingham.edu.cn' }
  const plan = planIdentityMigration([base, verified, { ...base, _id: 'duplicate' }])
  assert.equal(plan.canonical[0].id, 'verified-original')
  assert.deepEqual(plan.canonical[0].defaults, { profile_version: 0 })
  assert.equal(plan.archives.length, 2)
  assert.equal(plan.archives.every(item => item.canonical_id === 'verified-original'), true)
  assert.equal(plan.claims[0]._id, stableDocumentId('email:claim', verified.email))
  assert.equal(new Set([...plan.canonical.map(item => item.source._id), ...plan.archives.map(item => item.source._id)]).size, 3)
  assert.equal(verified.profile_version, undefined)
})
test('migration refuses ambiguous identity, verification, role and email conflicts', () => {
  assert.throws(() => planIdentityMigration([base, { ...base, _id: 'other' }]), /Ambiguous/)
  const verified = { ...base, verified: true, email: 'fixture@nottingham.edu.cn' }
  assert.throws(() => planIdentityMigration([verified, { ...verified, _id: 'other' }]), /Multiple verified/)
  assert.throws(() => planIdentityMigration([verified, { ...base, _id: 'other', role: 'admin' }]), /roles/)
  assert.throws(() => planIdentityMigration([verified, { ...verified, _id: 'other', _openid: 'bob' }]), /multiple verified identities/)
  assert.throws(() => planIdentityMigration([{ ...base, verified: 'true' }]), /verification/)
})

test('migration snapshot comparison normalizes BSON dates but detects live account changes', () => {
  const exported = [{ ...base, created_at: { $date: '2026-01-01T00:00:00.000Z' } }]
  const queried = [{ ...base, created_at: { $date: { $numberLong: String(Date.parse('2026-01-01T00:00:00.000Z')) } } }]
  assert.equal(compareIdentitySnapshot(exported, queried).unchanged, true)
  assert.equal(compareIdentitySnapshot(exported, [{ ...queried[0], nickname: 'Changed' }]).changedOrAdded, 1)
  assert.equal(compareIdentitySnapshot(exported, []).missing, 1)
})
