const test = require('node:test')
const assert = require('node:assert/strict')
const { authorizeAction, checkAdmin, withAuth } = require('../apps/cloudfunctions/common')
test('administrator actions require a verified account; an unverified author can still delete their own content', async () => {
  let account = { _openid: 'admin', role: 'admin', verified: false }
  const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [account] }) }) }) }) }
  assert.equal((await authorizeAction(db, 'admin', 'posts', 'flag')).response.code, 'UNKNOWN_ACTION')
  assert.equal((await authorizeAction(db, 'admin', 'categories', 'create')).allowed, false)
  assert.equal(await checkAdmin(db, 'admin'), false)
  assert.equal((await authorizeAction(db, 'admin', 'posts', 'delete')).allowed, true)
  account = { ...account, verified: true }
  assert.equal((await authorizeAction(db, 'admin', 'posts', 'flag')).response.code, 'UNKNOWN_ACTION')
  assert.equal(await checkAdmin(db, 'admin'), true)
})

test('authorization rejects duplicate, wrong-owner and malformed account results', async () => {
  const owner = { _openid: 'alice', role: 'admin', verified: true }
  for (const data of [[owner, owner], [{ ...owner, _openid: 'bob' }], {}, [null]]) {
    const db = { collection: () => ({ where: () => ({ limit: take => {
      assert.equal(take, 2)
      return { get: async () => ({ data }) }
    } }) }) }
    assert.equal((await authorizeAction(db, 'alice', 'drafts', 'list')).response.code, 'AUTH_UNAVAILABLE')
    assert.equal(await checkAdmin(db, 'alice'), false)
  }
})

test('unknown prototype names never resolve to action policies or trigger account queries', async () => {
  const db = { collection() { throw Error('unexpected lookup') } }
  for (const [name, action] of [['posts', 'constructor'], ['posts', '__proto__'], ['constructor', 'name'], ['__proto__', 'toString']]) {
    assert.equal((await authorizeAction(db, 'alice', name, action)).response.code, 'UNKNOWN_ACTION')
  }
})

test('trusted runtime identity must be a nonempty string before a handler can run', async () => {
  let calls = 0
  for (const OPENID of [null, undefined, {}, 1, true, ' ', ' alice ']) {
    const main = withAuth({ getWXContext: () => ({ OPENID }) }, async () => { calls++; return {} })
    assert.equal((await main({ action: 'ensure', OPENID: 'alice' })).code, 'AUTH_FAILED')
  }
  assert.equal(calls, 0)
})
