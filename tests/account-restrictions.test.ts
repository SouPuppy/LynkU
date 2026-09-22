import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertAccountCapability, AccountRestrictionFailure, changeAccountRestrictions } from '@lynku/server'
import type { AccountRestrictions } from '@lynku/contracts'
test('restrictions affect only the selected capability and expire at the exact deadline', () => {
  const user = { verified: true, restrictions: { version: 1, posts: '2026-09-23T00:00:00.000Z', comments: null, messages: null } }
  assert.throws(() => assertAccountCapability(user, 'posts', '2026-09-22T23:59:59.999Z'), AccountRestrictionFailure)
  assert.doesNotThrow(() => assertAccountCapability(user, 'posts', '2026-09-23T00:00:00.000Z'))
  assert.doesNotThrow(() => assertAccountCapability(user, 'comments', '2026-09-22T23:59:59.999Z'))
  assert.doesNotThrow(() => assertAccountCapability(user, 'messages', '2026-09-22T23:59:59.999Z'))
  assert.equal(user.verified, true)
})
test('restriction retry has one version and audit and preserves certification', async () => {
  const user: Record<string, unknown> = { _id: 'user-a', verified: true, email: 'a@example.edu' }
  let audits = 0
  let receipt: { fingerprint: string; restrictions: AccountRestrictions } | null = null
  const store: Parameters<typeof changeAccountRestrictions>[0] = { now: () => '2026-09-22T00:00:00.000Z', run: work => work({
    authorize: async () => {}, read: async () => user, receipt: async () => receipt,
    update: async (_id, restrictions) => { user.restrictions = restrictions },
    record: async (_id, fingerprint, _account, restrictions) => { receipt = { fingerprint, restrictions }; audits++ },
  }) }
  const request = { accountId: 'user-a', expectedVersion: 0, capability: 'messages', until: '2026-09-23T00:00:00.000Z', reason: '骚扰处理', requestId: 'restriction-0001' }
  const result = await changeAccountRestrictions(store, request)
  assert.equal(result.version, 1)
  assert.deepEqual(await changeAccountRestrictions(store, request), result)
  assert.equal(audits, 1); assert.equal(user.verified, true); assert.equal(user.email, 'a@example.edu')
  await assert.rejects(changeAccountRestrictions(store, { ...request, until: null }), AccountRestrictionFailure)
})
