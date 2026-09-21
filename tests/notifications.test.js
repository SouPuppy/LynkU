const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { listUserNotifications, markUserNotificationsRead, countUserNotifications, InvalidNotificationRequest } = require('@lucky/server')
const hash = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex')
const date = '2026-09-21T00:00:00.000Z'
const notification = id => ({ _id: id, to: 'alice', type: 'comment', anonymous: true,
  actor: { _openid: 'secret-author', nickname: 'Secret', avatar_url: '/secret', email: 'secret-email' },
  target: { post_id: 'post', comment_preview: 'hello', private_author: 'secret-author' },
  private_context: 'secret-context', read: false, created_at: new Date(date) })

test('notification pagination covers tied timestamps and strips private anonymous data', async () => {
  const rows = Array.from({ length: 55 }, (_, i) => notification(`n${String(55 - i).padStart(3, '0')}`))
  let reads = 0
  const store = { identifier: hash, list: async (owner, unreadOnly, cursor, take) => {
    reads++
    assert.equal(owner, 'alice'); assert.equal(unreadOnly, false); assert.equal(take, 21)
    return rows.filter(row => !cursor || row._id < cursor.id).slice(0, take)
  } }
  const seen = []
  let cursor
  do {
    const page = await listUserNotifications(store, 'alice', { cursor })
    assert.ok(!JSON.stringify(page).includes('secret'))
    seen.push(...page.notifications.map(row => row._id))
    cursor = page.nextCursor || undefined
  } while (cursor)
  assert.equal(reads, 3)
  assert.deepEqual(seen, rows.map(row => row._id))
  const first = await listUserNotifications(store, 'alice', {})
  const before = reads
  await assert.rejects(listUserNotifications(store, 'bob', { cursor: first.nextCursor }), InvalidNotificationRequest)
  await assert.rejects(listUserNotifications(store, 'alice', { cursor: first.nextCursor, unreadOnly: true }), InvalidNotificationRequest)
  assert.equal(reads, before)
})

test('notification reads require explicit IDs and propagate storage and count faults', async () => {
  let calls = 0
  const store = { identifier: hash, markRead: async (owner, ids) => {
    calls++; assert.equal(owner, 'alice'); assert.deepEqual(ids, ['n1', 'n2']); return 2
  }, unreadCount: async () => -1 }
  for (const ids of [undefined, [], Array(101).fill('n1'), ['']]) {
    await assert.rejects(markUserNotificationsRead(store, 'alice', ids), InvalidNotificationRequest)
  }
  assert.equal(calls, 0)
  assert.equal(await markUserNotificationsRead(store, 'alice', ['n1', 'n1', 'n2']), 2)
  await assert.rejects(countUserNotifications(store, 'alice'), /Invalid notification count/)
  await assert.rejects(markUserNotificationsRead({ ...store, markRead: async () => { throw Error('offline') } }, 'alice', ['n1']), /offline/)
  await assert.rejects(listUserNotifications({ ...store, list: async () => [{ ...notification('n1'), to: 'bob' }] }, 'alice', {}), /scope mismatch/)
  await assert.rejects(listUserNotifications({ ...store, list: async () => [notification('n1'), notification('n2')] }, 'alice', {}), /order/)
})
