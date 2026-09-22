const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { isBuiltin } = require('node:module')

async function verify() {
  const filename = process.argv[2]
  const functionName = process.argv[3]
  let openid = ''
  let verified = false
  const queries = []
  const normalize = value => JSON.parse(JSON.stringify(value))
  const timestamp = '2026-09-21T00:00:00.000Z'
  const owner = 'artifact-test-account'
  const peer = 'artifact-test-peer'
  const privatePeer = 'artifact-private-anonymous-peer'
  const rows = [{
    _id: 'a'.repeat(64), owner_openid: owner, peer_openid: peer,
    updated_at: timestamp, unread_count: 2, anonymous_context: null,
    last_message: { _id: 'message-public', content: 'bundle directory probe', created_at: timestamp, internal: 'private' },
  }, {
    _id: 'b'.repeat(64), owner_openid: owner, peer_openid: privatePeer,
    updated_at: timestamp, unread_count: 1,
    anonymous_context: { initiator_openid: owner, target_openid: privatePeer,
      source_type: 'post', source_id: 'public-source', thread_id: 'c'.repeat(64) },
    last_message: { _id: 'message-anonymous', content: 'anonymous bundle probe', created_at: timestamp },
  }]
  const database = {
    command: { in: values => ({ operator: 'in', values }) },
    collection(name) {
      let condition
      let take
      let fields
      const order = []
      const query = {
        where(value) { condition = normalize(value); return query },
        limit(value) { take = value; return query },
        orderBy(field, direction) { order.push([field, direction]); return query },
        field(value) { fields = normalize(value); return query },
        async get() {
          queries.push({ name, condition, take, fields, order })
          if (name === 'users' && condition._openid === owner) {
            assert.equal(take, 2)
            return { data: [{ _openid: owner, verified, role: 'user' }] }
          }
          if (name === 'conversation_entries') {
            assert.deepEqual(condition, { owner_openid: owner })
            assert.equal(take, 3)
            assert.deepEqual(order, [['updated_at', 'desc'], ['_id', 'desc']])
            return { data: rows }
          }
          if (name === 'users') {
            assert.deepEqual(condition, { _openid: { operator: 'in', values: [peer] } })
            assert.deepEqual(fields, { _openid: true, nickname: true, avatar_url: true })
            return { data: [{ _openid: peer, nickname: 'Artifact peer', avatar_url: '', email: 'private@example.invalid', role: 'admin' }] }
          }
          throw new Error(`Unexpected artifact query: ${name}`)
        },
      }
      return query
    },
  }
  const sdk = {
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: openid }),
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, Buffer, URL,
    process: { env: {} }, setTimeout, clearTimeout,
    require(specifier) {
      if (specifier === 'wx-server-sdk') return sdk
      if (specifier === '@cloudbase/node-sdk') return { init: () => ({ auth: () => ({ getAuthContext: async () => ({ uid: openid, loginType: 'PASSWORD' }) }) }) }
      if (isBuiltin(specifier)) return require(specifier)
      throw new Error(`Bundle depends on an unpackaged module: ${specifier}`)
    },
  }, { filename, timeout: 5000 })
  assert.equal(typeof module.exports.main, 'function')
  const unauthorized = await module.exports.main({ action: '__artifact_probe__' }, {})
  assert.equal(unauthorized.code, 'AUTH_FAILED')
  openid = owner
  const unknownAction = await module.exports.main({ action: '__artifact_probe__' }, {})
  assert.equal(unknownAction.code, 'UNKNOWN_ACTION')
  assert.equal(queries.length, 0, 'Probe actions should not access application data')

  if (functionName === 'messages') {
    const event = { action: 'listConversations', limit: 2, openid: 'spoofed-owner', verified: true, role: 'admin' }
    const denied = await module.exports.main(event, {})
    assert.equal(denied.code, 'EMAIL_NOT_VERIFIED', 'Client input cannot elevate a guest account')
    assert.equal(queries.filter(query => query.name === 'conversation_entries').length, 0)
    verified = true
    const result = normalize(await module.exports.main(event, {}))
    assert.equal(result.code, undefined, JSON.stringify(result))
    assert.deepEqual(result.data, {
      source: 'directory', hasMore: false, nextCursor: null,
      conversations: [{
        peer: { _openid: peer, nickname: 'Artifact peer', avatar_url: '' },
        lastMessage: { _id: 'message-public', content: 'bundle directory probe', created_at: timestamp }, unreadCount: 2,
      }, {
        peer: { nickname: '匿名用户', avatar_url: '/assets/anonymous.png' },
        lastMessage: { _id: 'message-anonymous', content: 'anonymous bundle probe', created_at: timestamp }, unreadCount: 1,
        chat_target: { anonymous: true, thread_id: 'c'.repeat(64) },
      }],
    })
    assert.equal(queries.filter(query => query.name === 'conversation_entries').length, 1)
    assert.ok(!JSON.stringify(result).includes(privatePeer), 'Anonymous peer identity must not escape the bundle')
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
