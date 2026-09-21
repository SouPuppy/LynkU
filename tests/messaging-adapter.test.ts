import assert = require('node:assert/strict')
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { sendNewMessage, markMessagesRead, listConversationDirectory, syncMessages,
  readMessageHistory, readReceipts, listUserNotifications, resolveConversationTarget } from '@lucky/server'
import { createCloudBaseMessagingAdapters, MessageRecipientUnavailable } from '../packages/adapters/src'
import type { MessagingCollection, MessagingDatabase, MessagingDocument, MessagingQuery } from '../packages/adapters/src'

type Row = Record<string, unknown>
type State = Map<string, Map<string, Row>>
const timestamp = new Date('2026-09-21T01:00:00.000Z')
const identifier = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex')
const conversation = { id: identifier('conversation', 'direct', 'alice', 'bob'), viewer: 'alice', peer: 'bob' }

function object(value: unknown): Row {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Row
}

function compare(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left === right ? 0 : 1
  throw new Error('Unsupported fixture comparison')
}

function matches(row: Row, condition: object): boolean {
  const expression = object(condition)
  if (expression.op === 'and' || expression.op === 'or') {
    const values: unknown = expression.values
    assert.ok(Array.isArray(values))
    return expression.op === 'and' ? values.every(value => matches(row, object(value)))
      : values.some(value => matches(row, object(value)))
  }
  return Object.entries(expression).every(([key, expected]) => {
    const actual = row[key]
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime()
    if (expected && typeof expected === 'object') {
      const operation = object(expected)
      if (operation.op === 'lt') return compare(actual, operation.value) < 0
      if (operation.op === 'gt') return compare(actual, operation.value) > 0
      if (operation.op === 'neq') return actual !== operation.value
      if (operation.op === 'in') {
        const values: unknown = operation.value
        assert.ok(Array.isArray(values))
        return values.includes(actual)
      }
      throw new Error('Unsupported fixture predicate')
    }
    return actual === expected
  })
}

function fixture() {
  let state: State = new Map()
  let queue = Promise.resolve()
  let failDirectory = false
  let corrupt = false
  let response: unknown
  let rateCalls = 0
  let rateFailure = false
  const records = (data: State, collection: string) => {
    let rows = data.get(collection)
    if (!rows) { rows = new Map(); data.set(collection, rows) }
    return rows
  }
  function document(data: State, collection: string, id: string,
    onRead = () => {}, onWrite = () => {}): MessagingDocument {
    return {
      async get() {
        onRead()
        return corrupt ? response : { data: structuredClone(records(data, collection).get(id) ?? null) }
      },
      async set(options) {
        onWrite()
        if (failDirectory && collection === 'conversation_entries' && options.data.owner_openid === 'bob') {
          throw new Error('directory write failed')
        }
        assert.equal(options.data._id, undefined, 'document ID belongs to the SDK reference')
        records(data, collection).set(id, { ...structuredClone(options.data), _id: id })
        return { stats: { updated: 1 } }
      },
      async update(options) {
        onWrite()
        if (failDirectory && collection === 'conversation_entries') throw new Error('directory write failed')
        const row = records(data, collection).get(id)
        assert.ok(row)
        for (const [key, value] of Object.entries(options.data)) {
          if (key === 'last_message.status') object(row.last_message).status = value
          else row[key] = structuredClone(value)
        }
        return { stats: { updated: 1 } }
      },
    }
  }
  function query(collection: string, condition: object = {}, order: [string, 'asc' | 'desc'][] = [],
    take = Number.MAX_SAFE_INTEGER, fields?: Record<string, boolean>): MessagingQuery {
    const selected = () => {
      const rows = [...records(state, collection).values()].filter(row => matches(row, condition))
      rows.sort((left, right) => {
        for (const [field, direction] of order) {
          const compared = compare(left[field], right[field])
          if (compared !== 0) return direction === 'asc' ? compared : -compared
        }
        return 0
      })
      return rows.slice(0, take)
    }
    return {
      where: next => query(collection, next, order, take, fields),
      orderBy: (field, direction) => query(collection, condition, [...order, [field, direction]], take, fields),
      limit: limit => query(collection, condition, order, limit, fields),
      field: projection => query(collection, condition, order, take, projection),
      async get() {
        if (corrupt) return response
        return { data: selected().map(row => fields
          ? Object.fromEntries(Object.keys(fields).filter(field => fields[field]).map(field => [field, row[field]]))
          : structuredClone(row)) }
      },
      async count() { return corrupt ? response : { total: selected().length } },
      async update(options) {
        const rows = selected()
        for (const row of rows) Object.assign(row, options.data)
        return corrupt ? response : { stats: { updated: rows.length } }
      },
    }
  }
  const db: MessagingDatabase = {
    collection(name): MessagingCollection {
      return { ...query(name), doc: id => document(state, name, id) }
    },
    command: {
      and: values => ({ op: 'and', values }), or: values => ({ op: 'or', values }),
      lt: value => ({ op: 'lt', value }), gt: value => ({ op: 'gt', value }),
      neq: value => ({ op: 'neq', value }), in: value => ({ op: 'in', value }),
    },
    serverDate: () => timestamp,
    runTransaction(operation) {
      const result = queue.then(async () => {
        const pending = structuredClone(state)
        let writing = false
        const returned = await operation({ collection: name => ({
          doc: id => document(pending, name, id,
            () => assert.equal(writing, false, 'transaction reads precede writes'),
            () => { writing = true }),
        }) })
        state = pending
        return returned
      })
      queue = result.then(() => {}, () => {})
      return result
    },
  }
  const adapters = createCloudBaseMessagingAdapters(db, { identifier,
    async authorizeSendRate() { rateCalls++; if (rateFailure) throw new Error('rate rejected') },
  })
  const seed = (collection: string, id: string, row: Row) => records(state, collection).set(id, { ...row, _id: id })
  seed('users', 'alice-user', { _openid: 'alice', nickname: 'Alice', avatar_url: '' })
  seed('users', 'bob-user', { _openid: 'bob', nickname: 'Bob', avatar_url: '' })
  return { db, adapters, seed,
    row: (collection: string, id: string) => records(state, collection).get(id),
    rows: (collection: string) => [...records(state, collection).values()],
    rates: () => rateCalls,
    failDirectory: (value: boolean) => { failDirectory = value },
    failRate: () => { rateFailure = true },
    corrupt: (value: unknown) => { corrupt = true; response = value },
  }
}

test('CloudBase adapter sends atomically, preserves sequence and deduplicates concurrent retries', async () => {
  const f = fixture()
  const store = f.adapters.createSendStore(conversation.id, 'alice', 'bob')
  const request = { msg_id: 'first', content: 'hello' }
  f.failDirectory(true)
  await assert.rejects(sendNewMessage(store, conversation, null, request), /directory write failed/)
  assert.equal(f.rows('messages').length, 0)
  assert.equal(f.rows('conversation_counters').length, 0)
  assert.equal(f.rows('conversation_entries').length, 0)
  f.failDirectory(false)
  const results = await Promise.all([sendNewMessage(store, conversation, null, request),
    sendNewMessage(store, conversation, null, request)])
  assert.deepEqual(results.map(result => result.status).sort(), ['duplicate', 'sent'])
  assert.equal(f.rows('messages').length, 1)
  assert.equal(f.row('conversation_counters', conversation.id)?.last_sequence, 1)
  assert.equal(f.row('conversation_entries', identifier('conversation_entry', 'bob', conversation.id))?.unread_count, 1)
  assert.equal(f.row('conversation_entries', identifier('conversation_entry', 'alice', conversation.id))?.unread_count, 0)
  await sendNewMessage(store, conversation, null, { msg_id: 'second', content: 'next' })
  assert.equal(f.row('conversation_counters', conversation.id)?.last_sequence, 2)
  assert.equal(f.row('messages', identifier('alice', 'second'))?.sync_sequence, 2)
})

test('CloudBase read transaction rolls back with its directory and repeat reads are idempotent', async () => {
  const f = fixture()
  const sent = await sendNewMessage(f.adapters.createSendStore(conversation.id, 'alice', 'bob'),
    conversation, null, { msg_id: 'first', content: 'hello' })
  const reader = { ...conversation, viewer: 'bob', peer: 'alice' }
  const store = f.adapters.createReadStore(conversation.id, 'bob')
  const id = sent.message._id
  const directoryId = identifier('conversation_entry', 'bob', conversation.id)
  const activity = f.row('conversation_entries', directoryId)?.updated_at
  f.failDirectory(true)
  await assert.rejects(markMessagesRead(store, reader, [id]), /directory write failed/)
  assert.equal(f.row('messages', id)?.status, 'sent')
  assert.equal(f.row('conversation_entries', directoryId)?.unread_count, 1)
  f.failDirectory(false)
  assert.equal(await markMessagesRead(store, reader, [id]), 1)
  assert.equal(await markMessagesRead(store, reader, [id]), 0)
  assert.equal(f.row('conversation_entries', directoryId)?.unread_count, 0)
  assert.deepEqual(f.row('conversation_entries', directoryId)?.updated_at, activity)
  assert.equal(object(f.row('conversation_entries', directoryId)?.last_message).status, 'read')
  assert.deepEqual(await readReceipts(f.adapters.readReceiptStore, conversation, [id]), [id])
  assert.equal(await f.adapters.unreadMessageCount('bob'), 0)
})

test('CloudBase history, sync and directory queries preserve owner and cursor boundaries', async () => {
  const f = fixture()
  const store = f.adapters.createSendStore(conversation.id, 'alice', 'bob')
  for (const msg_id of ['one', 'two', 'three']) await sendNewMessage(store, conversation, null, { msg_id, content: msg_id })
  f.seed('messages', 'foreign', { conversation_id: 'other', sync_sequence: 99 })
  const history = await readMessageHistory(f.adapters.historyStore, conversation, {
    limit: 1, before: { version: 2, conversation_id: conversation.id, sequence: 3 },
  })
  assert.deepEqual(history.messages.map(message => message.sync_sequence), [2])
  assert.equal(history.hasMore, true)
  const sync = await syncMessages(f.adapters.messageSyncStore, conversation, {
    limit: 1, cursor: { version: 2, conversation_id: conversation.id, sequence: 1 },
  })
  assert.deepEqual(sync.messages.map(message => message.sync_sequence), [2])
  assert.equal(sync.hasMore, true)
  const directory = await listConversationDirectory(f.adapters.directoryStore,
    { ownerId: 'bob', scope: identifier('directory', 'bob') }, {})
  assert.equal(directory.conversations.length, 1)
  assert.equal(directory.conversations[0]?.peer.nickname, 'Alice')
  assert.equal(directory.conversations[0]?.unreadCount, 3)
  const ownerEntry = f.row('conversation_entries', identifier('conversation_entry', 'bob', conversation.id))
  assert.ok(ownerEntry)
  f.seed('conversation_entries', 'f'.repeat(64), { ...ownerEntry, _id: undefined })
  const first = await listConversationDirectory(f.adapters.directoryStore,
    { ownerId: 'bob', scope: identifier('directory', 'bob') }, { limit: 1 })
  assert.ok(first.nextCursor)
  const second = await listConversationDirectory(f.adapters.directoryStore,
    { ownerId: 'bob', scope: identifier('directory', 'bob') }, { limit: 1, cursor: first.nextCursor })
  assert.equal(first.hasMore, true)
  assert.equal(second.conversations.length, 1)
  assert.equal(second.hasMore, false)
})

test('CloudBase notifications remain owner scoped across pagination, counting and read writes', async () => {
  const f = fixture()
  const notification = { to: 'alice', read: false, type: 'comment', created_at: timestamp,
    anonymous: false, actor: { _openid: 'bob', nickname: 'Bob', avatar_url: '' },
    target: { post_id: 'post', comment_id: 'comment', post_title: 'title', comment_preview: 'hello' } }
  f.seed('notifications', 'n1', notification)
  f.seed('notifications', 'n2', notification)
  f.seed('notifications', 'other', { ...notification, to: 'bob' })
  const first = await listUserNotifications(f.adapters.notificationStore, 'alice', { limit: 1 })
  assert.equal(first.notifications[0]?._id, 'n2')
  assert.ok(first.nextCursor)
  const second = await listUserNotifications(f.adapters.notificationStore, 'alice', { limit: 1, cursor: first.nextCursor })
  assert.equal(second.notifications[0]?._id, 'n1')
  assert.equal(second.hasMore, false)
  assert.equal(await f.adapters.notificationStore.unreadCount('alice'), 2)
  assert.equal(await f.adapters.notificationStore.markRead('alice', ['n1', 'other']), 1)
  assert.equal(f.row('notifications', 'other')?.read, false)
  assert.equal(await f.adapters.notificationStore.unreadCount('alice'), 1)
})

test('CloudBase target adapter authorizes existing anonymous conversations after source deletion', async () => {
  const f = fixture()
  const thread = identifier('anonymous_chat', 'post', 'source', 'alice', 'bob')
  const conversationId = identifier('conversation', 'anonymous', thread)
  f.seed('posts', 'source', { status: 'deleted', anonymous: true, _openid: 'bob' })
  f.seed('conversation_entries', identifier('conversation_entry', 'alice', conversationId), {
    owner_openid: 'alice', peer_openid: 'bob', conversation_id: conversationId,
    anonymous_context: { source_type: 'post', source_id: 'source', initiator_openid: 'alice', target_openid: 'bob', thread_id: thread },
  })
  const input = { anonymous_target: { anonymous: true, type: 'post', id: 'source', thread_id: thread } }
  const resolved = await resolveConversationTarget(f.adapters.targetStore, 'alice', input)
  assert.equal(resolved.peer, 'bob')
  await assert.rejects(resolveConversationTarget(f.adapters.targetStore, 'mallory', input))
})

test('CloudBase adapter rejects malformed envelopes and propagates policy failures before writes', async () => {
  for (const response of [undefined, {}, { data: undefined }, { data: [] }, { data: 'record' }]) {
    const f = fixture()
    f.corrupt(response)
    await assert.rejects(sendNewMessage(f.adapters.createSendStore(conversation.id, 'alice', 'bob'),
      conversation, null, { msg_id: 'one', content: 'hello' }), /Invalid CloudBase/)
    assert.equal(f.rates(), 0)
    assert.equal(f.rows('messages').length, 0)
  }
  for (const response of [{ total: -1 }, { total: '2' }, { total: 1.5 }]) {
    const f = fixture()
    f.corrupt(response)
    await assert.rejects(f.adapters.unreadMessageCount('alice'), /Invalid CloudBase count/)
  }
  const unavailable = fixture()
  await assert.rejects(unavailable.adapters.createSendStore(conversation.id, 'alice', 'missing')
    .authorizeRecipientAndRate(), MessageRecipientUnavailable)
  assert.equal(unavailable.rates(), 0)
  for (const response of [{ data: null }, { data: [null] }, { data: [{ _openid: 'mallory' }] }]) {
    const invalidRecipient = fixture()
    invalidRecipient.corrupt(response)
    await assert.rejects(invalidRecipient.adapters.createSendStore(conversation.id, 'alice', 'bob')
      .authorizeRecipientAndRate())
    assert.equal(invalidRecipient.rates(), 0)
  }
  const limited = fixture()
  limited.failRate()
  await assert.rejects(sendNewMessage(limited.adapters.createSendStore(conversation.id, 'alice', 'bob'),
    conversation, null, { msg_id: 'one', content: 'hello' }), /rate rejected/)
  assert.equal(limited.rows('messages').length, 0)
})
