const assert = require('node:assert/strict')
const test = require('node:test')
const { confirmSchoolEmail } = require('@lucky/server')
const email = 'student@nottingham.edu.cn'
function fixture() {
  const rows = new Map()
  for (const owner of ['alice', 'bob']) {
    rows.set(`users/${owner}`, { _id: owner, _openid: owner, nickname: owner, avatar_url: '', verified: false, role: 'user', email: '' })
    rows.set(`email_verifications/${owner}`, { _openid: owner, email, code_hash: `${owner}:012345`, consumed: false,
      attempts: 0, expires_at_ms: 10000, delivery_status: 'sent' })
  }
  const state = { rows, now: 1000, failAccount: false }
  let tail = Promise.resolve()
  const store = { findUser: async owner => rows.get(`users/${owner}`), emailAvailable: async () => true,
    challengeId: owner => owner, claimId: address => address, hash: (owner, address, code) => `${owner}:${code}`, now: () => state.now,
    run(work) {
      const promise = tail.then(async () => {
        const staged = structuredClone(rows)
        const result = await work({
          get: async (collection, id) => staged.get(`${collection}/${id}`) || null,
          update: async (collection, id, fields) => {
            if (collection === 'users' && state.failAccount) throw Error('account write failed')
            staged.set(`${collection}/${id}`, { ...staged.get(`${collection}/${id}`), ...fields })
          },
          put: async (collection, id, value) => staged.set(`${collection}/${id}`, value),
          remove: async (collection, id) => staged.delete(`${collection}/${id}`),
        })
        rows.clear(); for (const [key, value] of staged) rows.set(key, value)
        return result
      })
      tail = promise.catch(() => {})
      return promise
    },
  }
  return { store, state }
}
test('email ownership is exclusive across concurrent accounts and successful retry is idempotent', async () => {
  const { store, state } = fixture()
  const outcomes = await Promise.allSettled(['alice', 'bob'].map(owner => confirmSchoolEmail(store, owner, { email, code: '012345' })))
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'EMAIL_IN_USE')
  const owner = state.rows.get(`email_claims/${email}`).owner_openid
  const account = await confirmSchoolEmail(store, owner, { email, code: '012345' })
  assert.equal(account.verified, true)
  assert.equal(account.email, email)
  assert.equal(state.rows.get(`email_verifications/${owner}`).consumed, true)
})
test('concurrent wrong codes stop at five committed failures without verifying the account', async () => {
  const { store, state } = fixture()
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => confirmSchoolEmail(store, 'alice', { email, code: '999999' })))
  assert.equal(outcomes.filter(result => result.reason.code === 'INVALID_CODE').length, 5)
  assert.equal(outcomes.filter(result => result.reason.code === 'TOO_MANY_ATTEMPTS').length, 3)
  assert.equal(state.rows.get('email_verifications/alice').attempts, 5)
  assert.equal(state.rows.get('users/alice').verified, false)
})
test('failed account writes roll back claims and code consumption; expired or unsent codes cannot bind', async () => {
  const { store, state } = fixture()
  state.failAccount = true
  await assert.rejects(confirmSchoolEmail(store, 'alice', { email, code: '012345' }), /account write failed/)
  assert.equal(state.rows.has(`email_claims/${email}`), false)
  assert.equal(state.rows.get('email_verifications/alice').consumed, false)
  state.failAccount = false
  state.now = 10000
  await assert.rejects(confirmSchoolEmail(store, 'alice', { email, code: '012345' }), { code: 'CODE_EXPIRED' })
  state.now = 1000
  state.rows.get('email_verifications/alice').delivery_status = 'sending'
  await assert.rejects(confirmSchoolEmail(store, 'alice', { email, code: '012345' }), { code: 'CODE_NOT_FOUND' })
  assert.equal(state.rows.get('users/alice').verified, false)
})
