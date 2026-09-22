import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeAdmin, hasAdminCapability, type AdminAuthorizationStore } from '@lynku/server'

function store(member: unknown, account: unknown): AdminAuthorizationStore {
  return {
    member: async () => member as never,
    account: async () => account as never,
  }
}

test('web administration needs a pre-bound active Web identity and an active verified business administrator', async () => {
  const principal = await authorizeAdmin(store(
    { webUid: 'web-user', accountId: 'account-1', kind: 'business', role: 'community', status: 'active', version: 4 },
    { id: 'account-1', lifecycle: 'active', role: 'admin', verified: true },
  ), 'web-user')
  assert.equal(principal.accountId, 'account-1')
  assert.equal(hasAdminCapability(principal, 'governance:write'), true)
  assert.equal(hasAdminCapability(principal, 'settings:write'), false)
})

test('browser-provided roles and unbound, stale, anonymous-style, or closed accounts never become administrators', async () => {
  const account = { id: 'account-1', lifecycle: 'active', role: 'admin', verified: true }
  for (const [member, uid] of [
    [null, 'web-user'],
    [{ webUid: 'other-user', accountId: 'account-1', kind: 'business', role: 'owner', status: 'active', version: 0 }, 'web-user'],
    [{ webUid: 'web-user', accountId: 'account-1', kind: 'business', role: 'owner', status: 'revoked', version: 0 }, 'web-user'],
    [{ webUid: 'web-user', accountId: 'account-1', kind: 'business', role: 'owner', status: 'active', version: -1 }, 'web-user'],
  ] as const) {
    await assert.rejects(() => authorizeAdmin(store(member, account), uid), { code: 'FORBIDDEN' })
  }
  for (const changed of [
    { ...account, lifecycle: 'closing' },
    { ...account, role: 'user' },
    { ...account, verified: false },
  ] as const) {
    await assert.rejects(() => authorizeAdmin(store({ webUid: 'web-user', accountId: 'account-1', kind: 'business', role: 'owner', status: 'active', version: 0 }, changed), 'web-user'), { code: 'FORBIDDEN' })
  }
})

test('a platform owner is an explicitly provisioned Web administrator and never consults a mini-program account', async () => {
  const principal = await authorizeAdmin({
    member: async () => ({ webUid: 'web-owner', accountId: 'platform-owner:web-owner', kind: 'platform-owner', role: 'owner', status: 'active', version: 1 }),
    account: async () => { throw Error('Platform owner must not query business accounts') },
  }, 'web-owner')
  assert.equal(principal.role, 'owner')
  assert.equal(principal.accountId, 'platform-owner:web-owner')
})
