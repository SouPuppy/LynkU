import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeAdminMember, AdminMemberChangeFailure } from '@lynku/server'
import type { AdminMemberView } from '@lynku/contracts'
test('owner cannot revoke self; a request retry does not duplicate version or audit', async () => {
  let member: AdminMemberView = { id: 'owner-a', kind: 'business', role: 'owner', status: 'active', version: 3 }
  let actor = 'owner-a', audits = 0
  let receipt: { fingerprint: string; member: AdminMemberView } | null = null
  const store: Parameters<typeof changeAdminMember>[0] = { run: work => work({ authorize: async () => actor, receipt: async () => receipt,
    read: async () => member, update: async value => { member = value }, record: async (_id, fingerprint, value) => { audits++; receipt = { fingerprint, member: value } } }) }
  const request = { id: member.id, role: 'owner', status: 'revoked', expectedVersion: 3, requestId: 'request-member-0001', reason: '交接完成' }
  await assert.rejects(changeAdminMember(store, request), AdminMemberChangeFailure)
  assert.equal(member.status, 'active'); assert.equal(audits, 0)
  actor = 'owner-b'
  const result = await changeAdminMember(store, request)
  assert.equal(result.version, 4); assert.equal(result.status, 'revoked')
  assert.deepEqual(await changeAdminMember(store, request), result)
  assert.equal(audits, 1)
  await assert.rejects(changeAdminMember(store, { ...request, reason: 'changed' }), AdminMemberChangeFailure)
})
test('an independent platform owner cannot become a business role', async () => {
  const member: AdminMemberView = { id: 'platform-owner', kind: 'platform-owner', role: 'owner', status: 'active', version: 1 }
  let writes = 0
  const store: Parameters<typeof changeAdminMember>[0] = { run: work => work({ authorize: async () => 'other-owner', receipt: async () => null,
    read: async () => member, update: async () => { writes++ }, record: async () => { writes++ } }) }
  await assert.rejects(changeAdminMember(store, { id: member.id, role: 'viewer', status: 'active', expectedVersion: 1, requestId: 'request-member-0002', reason: 'change' }), AdminMemberChangeFailure)
  assert.equal(writes, 0)
})
