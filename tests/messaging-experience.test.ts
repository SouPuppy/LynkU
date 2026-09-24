import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { SendOperations, type SendOperation } from '../apps/miniprogram/features/messaging/send-operations'
import { deliverCommentNotification, listUserNotifications, resolveConversationTarget, projectConversationDisplay, blockedInConversation, readMessageHistory } from '../packages/server/src/index'
import { parseConversationDisplay } from '../packages/contracts/src/index'

const hash = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex')

test('automatic confirmation backs off while explicit retry remains available with the original payload', async () => {
  let now = 0, lookups = 0, sends = 0
  const controller = new SendOperations({ valid: () => true, now: () => now, save: () => {},
    changed: () => {}, confirmed: () => {}, lookup: async () => { lookups++; return null },
    send: async (id, text) => { sends++; assert.equal(id, 'fixed'); assert.equal(text, 'body'); return { msg_id: id } },
  }, [{ id: 'fixed', text: 'body', state: 'uncertain', error: '' }])
  await controller.recover(); await controller.recover()
  assert.equal(lookups, 1); assert.equal(sends, 0)
  now = 2000; await controller.recover()
  assert.equal(lookups, 2); assert.equal(sends, 0)
  await controller.retry('fixed')
  assert.equal(lookups, 3); assert.equal(sends, 1)
})

test('editing a failed send retains its recoverable text if storage cannot be updated', () => {
  const controller = new SendOperations({ valid: () => true, now: () => 0, save: () => { throw Error('storage full') },
    changed: () => {}, confirmed: () => {}, lookup: async () => null, send: async id => ({ msg_id: id }),
  }, [{ id: 'failed', text: 'keep this', state: 'failed', error: 'rejected' }])
  assert.throws(() => controller.editFailed('failed'), /storage/)
  assert.equal(controller.snapshot()[0]?.text, 'keep this')
})

test('send recovery preserves frozen payload, confirms lost response, and never automatically resends', async () => {
  let sends = 0, stored: SendOperation[] = [], confirmed = 0
  let saved: { msg_id: string } | null = null
  const controller = new SendOperations({ valid: () => true, now: () => 0,
    save: items => { stored = structuredClone(items) }, changed: () => {},
    confirmed: () => { confirmed++ }, lookup: async () => saved,
    send: async (id, text) => { sends++; assert.equal(text, 'hello'); saved = { msg_id: id }; throw Error('lost reply') },
  }, [])
  await controller.submit('stable-id', 'hello')
  assert.equal(stored[0]?.state, 'uncertain')
  assert.equal(stored[0]?.id, 'stable-id')
  await controller.recover()
  assert.equal(sends, 1)
  assert.equal(confirmed, 1)
  assert.deepEqual(stored, [])
})

test('unknown sends stay recoverable across hide and restore; only explicit retry reuses the same id', async () => {
  let visible = true, sends = 0, stored: SendOperation[] = []
  let finish: ((message: { msg_id: string }) => void) | undefined
  const ports = { valid: () => visible, now: () => 0, save: (items: SendOperation[]) => { stored = structuredClone(items) },
    changed: () => {}, confirmed: () => {}, lookup: async () => null,
    send: (id: string) => { sends++; return new Promise<{ msg_id: string }>(resolve => { finish = resolve; assert.equal(id, 'same') }) } }
  const first = new SendOperations(ports, [])
  const sending = first.submit('same', 'body')
  visible = false; finish!({ msg_id: 'same' }); await sending
  assert.equal(stored.length, 1)
  visible = true
  const restored = new SendOperations(ports, stored)
  await restored.recover()
  assert.equal(sends, 1)
  const retry = restored.retry('same')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sends, 2)
  finish!({ msg_id: 'same' }); await retry
  assert.deepEqual(stored, [])
})

test('failed persistence prevents transmission and privacy changes invalidate confirmation callbacks', async () => {
  let sends = 0
  const controller = new SendOperations({ valid: () => true, now: () => 0, save: () => { throw Error('storage full') },
    changed: () => {}, confirmed: () => {}, lookup: async () => null,
    send: async () => { sends++; return { msg_id: 'id' } },
  }, [])
  await assert.rejects(controller.submit('id', 'body'), /storage/)
  assert.equal(sends, 0)
  assert.deepEqual(controller.snapshot(), [])
})

test('conversation display decoding exposes only directional identity fields', () => {
  for (const selfVisibility of ['anonymous', 'real']) for (const peerVisibility of ['anonymous', 'real']) {
    const value = parseConversationDisplay({ selfVisibility, peerVisibility, peerName: 'visible', peerAvatar: '', blockedHere: false,
      secretPeerId: 'hidden', email: 'private' })
    assert.equal(value.selfVisibility, selfVisibility)
    assert.equal(value.peerVisibility, peerVisibility)
    assert.equal(JSON.stringify(value).includes('hidden'), false)
  }
  assert.throws(() => parseConversationDisplay({ selfVisibility: 'guess' }))
})

test('server display projects all four identity combinations without leaking a hidden profile or other block actions', () => {
  for (const self of ['anonymous', 'real'] as const) for (const peer of ['anonymous', 'real'] as const) {
    const context = { protocol_version: 3 as const, source_type: 'post' as const, source_id: 'post',
      initiator_openid: 'alice', target_openid: 'bob', thread_id: 'a'.repeat(64), initiator_visibility: self, target_visibility: peer }
    const profile = { _openid: 'bob', nickname: 'Bob', avatar_url: '/bob', email: 'secret-mail' }
    const view = projectConversationDisplay('alice', context, profile, false)
    assert.equal(view.selfVisibility, self); assert.equal(view.peerVisibility, peer)
    assert.equal(view.peerName, peer === 'anonymous' ? '匿名会话 · AAAAAA' : 'Bob')
    assert.equal(JSON.stringify(view).includes('secret-mail'), false)
    if (peer === 'anonymous') assert.equal(JSON.stringify(view).includes('Bob'), false)
    assert.equal(projectConversationDisplay('bob', context, null, false).selfVisibility, peer)
  }
  const block = { blockedBy: ['alice'], operations: { alice: ['original'], bob: ['other'] } }
  assert.equal(blockedInConversation(block, 'alice', 'original'), true)
  assert.equal(blockedInConversation(block, 'alice', 'other'), false)
  assert.equal(blockedInConversation(block, 'bob', 'other'), false)
})

test('initial history anchors oldest unread even when it is outside the latest thirty messages', async () => {
  const rows = Array.from({ length: 90 }, (_, index) => ({ _id: `m${index + 1}`, msg_id: `r${index + 1}`,
    from: 'bob', to: 'alice', content: 'body', status: index >= 10 ? 'sent' : 'read',
    conversation_id: 'conversation', sync_sequence: index + 1, created_at: new Date('2026-09-23') }))
  const page = await readMessageHistory({ firstUnread: async () => rows[10]!,
    list: async (_id, before, take) => [...rows].reverse().filter(item => before === undefined || item.sync_sequence < before).slice(0, take),
  }, { id: 'conversation', viewer: 'alice', peer: 'bob' }, { limit: 30 })
  assert.equal(page.first_unread_id, 'm11')
  assert.equal(page.messages[0]?._id, 'm11')
  assert.equal(page.sync_cursor.sequence, 40)
  assert.equal(page.nextBefore?.sequence, 11)
})

const event = { type: 'comment', to: 'recipient', anonymous: true, actor: { _openid: 'secret' },
  target: { post_id: 'post', comment_id: 'comment', post_title: 'old', comment_preview: 'old' } }
function deliveryFixture() {
  const rows = new Map<string, Record<string, unknown>>()
  const source = { post: { _id: 'post', _openid: 'recipient', title: 'new', status: 'published' },
    comment: { _id: 'comment', _openid: 'secret', post_id: 'post', parent_id: null, depth: 0, anonymous: true,
      status: 'published', content: 'current body', created_at: new Date('2026-01-01'),
      author: { _openid: 'secret', nickname: 'Current', avatar_url: '/current', profile_version: 5 } }, parent: null }
  const tx = { read: async (id: string) => rows.get(id) ?? null,
    put: async (id: string, data: Record<string, unknown>) => { rows.set(id, { ...data, _id: id }) },
    remove: async (id: string) => { rows.delete(id) }, source: async () => source }
  return { rows, source, store: { identifier: hash, now: () => new Date('2026-09-23'),
    run: async <T>(work: (transaction: typeof tx) => Promise<T>): Promise<T> => work(tx) } }
}

test('anonymous notification IDs have no hidden identity input; delivery is idempotent and preserves event time', async () => {
  const f = deliveryFixture()
  await deliverCommentNotification(f.store, event)
  await deliverCommentNotification(f.store, event)
  const [id, row] = [...f.rows][0]!
  assert.equal(f.rows.size, 1)
  assert.equal(id, hash('notification', 'v2', event.type, event.to, event.target.comment_id))
  for (const candidate of ['first', 'secret', 'third']) assert.notEqual(id, hash('notification', event.type, event.to, candidate, event.target.comment_id))
  assert.deepEqual(row.created_at, new Date('2026-01-01'))
  assert.deepEqual(row.actor, { _openid: 'secret' })
})

test('late notification skips deleted source, uses latest profile, and preserves anonymity from the original event', async () => {
  const deleted = deliveryFixture(); deleted.source.comment.status = 'deleted'
  await deliverCommentNotification(deleted.store, event)
  assert.equal(deleted.rows.size, 0)
  const named = deliveryFixture(); named.source.comment.anonymous = false
  await deliverCommentNotification(named.store, { ...event, anonymous: false, actor: { _openid: 'secret', nickname: 'Old' } })
  assert.equal((([...named.rows.values()][0]!).actor as { nickname: string }).nickname, 'Current')
  const hidden = deliveryFixture(); hidden.source.comment.anonymous = false
  await deliverCommentNotification(hidden.store, event)
  assert.deepEqual(([...hidden.rows.values()][0]!).actor, { _openid: 'secret' })
})

test('rekeying a retried legacy notification preserves read state; public reads fail closed before migration', async () => {
  const f = deliveryFixture(), legacyId = hash('notification', event.type, event.to, 'secret', event.target.comment_id)
  const row = { ...event, _id: legacyId, read: true, created_at: new Date('2026-01-01') }
  f.rows.set(legacyId, row)
  await assert.rejects(listUserNotifications({ identifier: hash, list: async () => [row], contentSources: async () => ({ posts: [], comments: [] }),
    markRead: async () => 0, unreadCount: async () => 0 }, event.to, {}), /migration required/)
  await deliverCommentNotification(f.store, event)
  assert.equal(f.rows.has(legacyId), false)
  assert.equal(f.rows.size, 1)
  assert.equal(([...f.rows.values()][0]!).read, true)
})

test('new anonymous chat rejects changed source visibility after identity preview', async () => {
  await assert.rejects(resolveConversationTarget({ identifier: hash, directory: async () => null,
    source: async () => ({ _id: 'post', _openid: 'target-owner', anonymous: false, status: 'published' }) }, 'initiator', {
    anonymous_target: { anonymous: true, type: 'post', id: 'post', initiation_id: 'a'.repeat(24),
      initiator_visibility: 'real', expected_target_visibility: 'anonymous' },
  }))
})
