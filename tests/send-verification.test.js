const assert = require('node:assert/strict')
const test = require('node:test')
const { sendSchoolVerification, confirmSchoolEmail } = require('@lucky/server')
function fixture() {
  const rows = new Map([['users/alice', { _id: 'alice', _openid: 'alice', nickname: 'Alice', avatar_url: '', email: '', verified: false, role: 'user' }]])
  const state = { rows, now: 100000, sends: 0, failWrite: false, failSend: false }
  let tail = Promise.resolve(), generation = 0
  const store = { findUser: async () => rows.get('users/alice'), emailAvailable: async () => true,
    identifier: owner => owner, code: () => '012345', generation: () => String(++generation),
    hash: () => 'test-hash', now: () => state.now,
    send: async () => { state.sends++; if (state.failSend) throw Error('provider refused') },
    run(work) {
      const promise = tail.then(async () => {
        const staged = structuredClone(rows)
        const result = await work({
          get: async (collection, id) => staged.get(`${collection}/${id}`) || null,
          put: async (collection, id, value) => {
            if (collection === 'email_verifications' && state.failWrite) throw Error('reservation failed')
            staged.set(`${collection}/${id}`, value)
          },
          update: async (collection, id, value) => staged.set(`${collection}/${id}`, { ...staged.get(`${collection}/${id}`), ...value }),
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
test('concurrent sends share an account cooldown even for different email addresses', async () => {
  const { store, state } = fixture()
  const results = await Promise.allSettled(['one', 'two'].map(name => sendSchoolVerification(store, 'alice', { email: `${name}@nottingham.edu.cn` })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'EMAIL_RATE_LIMITED')
  assert.equal(state.sends, 1)
  assert.equal(state.rows.get('email_verifications/alice').delivery_status, 'sent')
  for (let i = 1; i < 5; i++) { state.now += 60000; await sendSchoolVerification(store, 'alice', { email: 'one@nottingham.edu.cn' }) }
  state.now += 60000
  await assert.rejects(sendSchoolVerification(store, 'alice', { email: 'one@nottingham.edu.cn' }), { code: 'EMAIL_RATE_LIMITED' })
  assert.equal(state.sends, 5)
})
test('reservation rollback prevents delivery and provider failure retains cooldown without leaking details', async () => {
  const { store, state } = fixture()
  state.failWrite = true
  await assert.rejects(sendSchoolVerification(store, 'alice', { email: 'one@nottingham.edu.cn' }), /reservation failed/)
  assert.equal(state.sends, 0)
  assert.equal(state.rows.has('email_send_limits/alice'), false)
  state.failWrite = false; state.failSend = true
  await assert.rejects(sendSchoolVerification(store, 'alice', { email: 'one@nottingham.edu.cn' }), { code: 'EMAIL_SEND_FAILED' })
  assert.equal(state.rows.get('email_verifications/alice').delivery_status, 'failed')
  assert.equal(state.rows.get('email_verifications/alice').consumed, true)
  await assert.rejects(sendSchoolVerification(store, 'alice', { email: 'two@nottingham.edu.cn' }), { code: 'EMAIL_RATE_LIMITED' })
  assert.equal(JSON.stringify([...state.rows]).includes('provider refused'), false)
})
test('late completion cannot overwrite a newer challenge or pending email', async () => {
  const { store, state } = fixture()
  let release, started
  const entered = new Promise(resolve => { started = resolve })
  const old = sendSchoolVerification({ ...store, send: async () => { started(); await new Promise(resolve => { release = resolve }) } }, 'alice', { email: 'old@nottingham.edu.cn' })
  const rejected = assert.rejects(old, { code: 'EMAIL_SEND_FAILED' })
  await entered
  state.now += 60000
  await sendSchoolVerification(store, 'alice', { email: 'new@nottingham.edu.cn' })
  release()
  await rejected
  assert.equal(state.rows.get('email_verifications/alice').email, 'new@nottingham.edu.cn')
  assert.equal(state.rows.get('email_verifications/alice').delivery_status, 'sent')
  assert.equal(state.rows.get('users/alice').email_pending, 'new@nottingham.edu.cn')
})

test('sent challenge binds the same account and rejects a superseded email challenge', async () => {
  const { store, state } = fixture()
  await sendSchoolVerification(store, 'alice', { email: 'old@nottingham.edu.cn' })
  state.now += 60000
  await sendSchoolVerification(store, 'alice', { email: 'new@nottingham.edu.cn' })
  const verificationStore = { ...store, challengeId: owner => owner, claimId: email => email }
  await assert.rejects(confirmSchoolEmail(verificationStore, 'alice', { email: 'old@nottingham.edu.cn', code: '012345' }), { code: 'CODE_NOT_FOUND' })
  const result = await confirmSchoolEmail(verificationStore, 'alice', { email: 'new@nottingham.edu.cn', code: '012345' })
  assert.equal(result.verified, true)
  assert.equal(result._openid, 'alice')
  assert.equal(state.rows.get('email_claims/new@nottingham.edu.cn').owner_openid, 'alice')
  assert.equal(state.rows.get('email_verifications/alice').consumed, true)
})
