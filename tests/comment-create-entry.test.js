const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { parsePublicNotification } = require('@lynku/contracts')

function fixture(failingRead = '', safetyResponse = { errcode: 0, result: { suggest: 'pass' } }) {
  const owner = 'private-comment-author'
  const stores = new Map([
    ['users', new Map([['account', { _id: 'account', _openid: owner, verified: true,
      role: 'user', nickname: 'Private nickname', avatar_url: '/private-avatar', profile_version: 0 }]])],
    ['posts', new Map([['post', { _id: 'post', _openid: 'post-owner', title: 'Campus',
      status: 'published', comment_count: 0 }]])],
  ])
  function table(name, target = stores) {
    if (!target.has(name)) target.set(name, new Map())
    return target.get(name)
  }
  function collection(name, target = stores) {
    const rows = table(name, target)
    return {
      where(condition) {
        return { limit: take => ({ get: async () => ({ data: [...rows.values()]
          .filter(row => Object.entries(condition).every(([key, value]) => row[key] === value)).slice(0, take) }) }) }
      },
      doc(id) {
        return {
          get: async () => {
            if (name === failingRead) throw new Error('Simulated database read outage')
            return { data: rows.get(id) || null }
          },
          set: async ({ data }) => { rows.set(id, { ...data, _id: id }) },
          update: async ({ data }) => {
            assert.ok(rows.has(id), `Missing fixture document ${name}/${id}`)
            rows.set(id, { ...rows.get(id), ...data, _id: id })
          },
        }
      },
    }
  }
  const db = {
    command: {}, collection,
    serverDate: () => new Date('2026-09-21T00:00:00.000Z'),
    async runTransaction(work) {
      const staged = new Map([...stores].map(([name, rows]) => [name, new Map(rows)]))
      const result = await work({ collection: name => collection(name, staged) })
      stores.clear()
      for (const [name, rows] of staged) stores.set(name, rows)
      return result
    },
  }
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: owner }),
    openapi: { security: { msgSecCheck: async () => safetyResponse } } }
  const module = { exports: {} }
  const filename = path.resolve(__dirname, '../apps/cloudfunctions/comments/index.ts')
  vm.runInNewContext(require('typescript').transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, {
    module, exports: module.exports, console, process: { env: {} },
    require: spec => spec === 'wx-server-sdk' ? cloud
      : spec === '../common' ? require('../apps/cloudfunctions/common')
      : require(spec.startsWith('.') ? path.resolve(path.dirname(filename), spec) : spec),
  }, { filename })
  return { main: module.exports.main, owner, table }
}

test('nonpassing official checks leave no comment, sequence, counter increment or notification candidate', async () => {
  for (const response of [{ errcode: 0, result: { suggest: 'review' } }, { errcode: 0, result: { suggest: 'risky' } }, null]) {
    const { main, table } = fixture('', response)
    const result = await main({ action: 'create', post_id: 'post', content: 'Campus comment', anonymous: false, request_id: 'rejected-request' })
    assert.equal(result.code, response === null ? 'MODERATION_UNAVAILABLE' : 'CONTENT_REJECTED')
    assert.equal(table('posts').get('post').comment_count, 0)
    for (const name of ['comments', 'comment_changes', 'comment_counters', 'notification_outbox', 'notifications']) assert.equal(table(name).size, 0, name)
  }
})

test('anonymous comment entry creates, deduplicates, counts and projects notifications without exposing its author', async () => {
  const { main, owner, table } = fixture()
  const event = { action: 'create', post_id: 'post', content: 'Helpful campus comment',
    anonymous: true, request_id: 'anonymous-comment-request' }
  const first = await main(event)
  assert.equal(first.code, undefined, JSON.stringify(first))
  assert.equal(first.data.status, 'created')
  assert.equal(first.data.comment.author.nickname, '匿名用户')
  assert.equal(first.data.comment.author.avatar_url, '/assets/anonymous.png')
  assert.equal(first.data.comment.is_mine, true)
  assert.equal(first.data.comment.anonymous, true)
  for (const secret of [owner, 'Private nickname', '/private-avatar']) {
    assert.equal(JSON.stringify(first).includes(secret), false)
  }
  const second = await main(event)
  assert.equal(second.data.status, 'duplicate')
  assert.equal(second.data.comment._id, first.data.comment._id)
  assert.equal(table('comments').size, 1)
  assert.equal(table('posts').get('post').comment_count, 1)
  assert.equal(table('comment_changes').size, 1)
  assert.equal(table('comment_counters').get('post').sequence, 1)
  assert.equal(table('notification_outbox').size, 1)
  assert.equal([...table('notification_outbox').values()][0].status, 'delivered')
  assert.equal(table('notifications').size, 1)
  const stored = [...table('notifications').values()][0]
  const visible = parsePublicNotification({ ...stored, created_at: stored.created_at.toISOString() })
  assert.equal(visible.actor.nickname, '匿名用户')
  assert.equal(JSON.stringify(visible).includes(owner), false)
  const removed = await main({ action: 'delete', comment_id: first.data.comment._id })
  assert.equal(removed.data.deleted, true)
  assert.equal(table('posts').get('post').comment_count, 0)
  assert.equal(table('comments').get(first.data.comment._id).content, '')
  assert.equal(table('comment_counters').get('post').sequence, 2)
  assert.equal([...table('comment_changes').values()].filter(change => change.type === 'deleted').length, 1)
  await main({ action: 'delete', comment_id: first.data.comment._id })
  assert.equal(table('comment_counters').get('post').sequence, 2)
})

test('comment counter or idempotency lookup failure never resets counters or commits a partial comment', async () => {
  for (const failingRead of ['comments', 'comment_counters']) {
    const { main, table } = fixture(failingRead)
    table('comment_counters').set('post', { _id: 'post', post_id: 'post', sequence: 19 })
    const result = await main({ action: 'create', post_id: 'post', content: 'Safe retry', anonymous: false, request_id: 'failed-request' })
    assert.equal(result.code, 'CREATE_ERROR')
    assert.equal(table('comments').size, 0)
    assert.equal(table('comment_counters').get('post').sequence, 19)
    assert.equal(table('posts').get('post').comment_count, 0)
    assert.equal(table('comment_changes').size, 0)
    assert.equal(table('notification_outbox').size, 0)
  }
})
