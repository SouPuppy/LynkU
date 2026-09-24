import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messagingRuntime } from './helpers/messaging-client-runtime'
import type * as Watch from '../apps/miniprogram/services/watch'
import type * as Session from '../apps/miniprogram/services/session'
import type { IMessage, IMessageSyncCursor, ISelfProfile } from '../apps/miniprogram/typings/cloudbase'

const profile: ISelfProfile = { _openid: 'alice', verified: true, nickname: 'Alice', avatar_url: '', role: 'user', email: '' }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const cursor = (sequence: number): IMessageSyncCursor => ({ version: 2, conversation_id: 'conversation', sequence })
const message = (sequence: number): IMessage => ({ _id: `message-${sequence}`, msg_id: `request-${sequence}`,
  from: 'bob', to: 'alice', content: 'hello', status: 'sent', created_at: '2026-09-24T00:00:00.000Z',
  conversation_id: 'conversation', sync_sequence: sequence })
const response = (data: unknown) => ({ result: { data } })
const syncPage = (sequence: number, messages: IMessage[] = []) => response({ messages, hasMore: false, nextCursor: cursor(sequence) })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const r = messagingRuntime()
  const session = r.load<typeof Session>('apps/miniprogram/services/session.ts')
  session.set(profile)
  const watch = r.load<typeof Watch>('apps/miniprogram/services/watch.ts')
  return { ...r, session, watch, poll: async () => {
    const callback = [...r.timers.values()][0]
    assert.ok(callback, 'message poll timer is active')
    await callback()
  } }
}

test('successful message sync reports healthy before a delayed receipt, and receipt failure preserves the advanced cursor', async () => {
  const r = fixture(), receipt = deferred<ReturnType<typeof response>>()
  const healthy: number[] = [], errors: Error[] = [], changes: number[] = [], cursors: number[] = [], read: string[] = []
  let receiptCalls = 0
  r.wx.cloud.callFunction = async ({ data }) => {
    if (data.action === 'syncConversation') {
      const sequence = (data.cursor as IMessageSyncCursor).sequence
      cursors.push(sequence)
      return syncPage(1, sequence === 0 ? [message(1)] : [])
    }
    assert.equal(data.action, 'getReadReceipts')
    receiptCalls++
    return receiptCalls === 1 ? receipt.promise : response({ readIds: ['sent-one'] })
  }
  const poller = r.watch.pollMessages('bob', cursor(0), rows => changes.push(...rows.map(row => row.sync_sequence!)), error => errors.push(error), null,
    { pending: () => ['sent-one'], apply: ids => read.push(...ids), healthy: value => healthy.push(value.sequence) })
  await tick()
  assert.deepEqual(changes, [1])
  assert.deepEqual(healthy, [1], 'receipt latency must not keep the connection in an unhealthy state')
  receipt.reject(new Error('network receipt failure'))
  await tick()
  assert.equal(errors.length, 0)
  assert.deepEqual(read, [])
  await r.poll()
  assert.deepEqual(cursors, [0, 1], 'receipt failure must not replay consumed message pages')
  assert.deepEqual(healthy, [1, 1])
  assert.deepEqual(read, ['sent-one'])
  poller.stop()
})

test('sync failure is reported once per failed poll and leaves receipts and healthy feedback untouched until recovery', async () => {
  const r = fixture(), errors: Error[] = [], healthy: number[] = [], actions: string[] = []
  let fail = true
  r.wx.cloud.callFunction = async ({ data }) => {
    actions.push(String(data.action))
    if (data.action === 'syncConversation') {
      if (fail) throw Error('network sync failure')
      assert.equal((data.cursor as IMessageSyncCursor).sequence, 0)
      return syncPage(0)
    }
    return response({ readIds: [] })
  }
  const poller = r.watch.pollMessages('bob', cursor(0), () => {}, error => errors.push(error), null,
    { pending: () => ['sent-one'], apply: () => {}, healthy: value => healthy.push(value.sequence) })
  await tick()
  await r.poll()
  assert.equal(errors.length, 2)
  assert.deepEqual(healthy, [])
  assert.deepEqual(actions, ['syncConversation', 'syncConversation'])
  fail = false
  await r.poll()
  assert.deepEqual(healthy, [0])
  assert.deepEqual(actions.slice(-2), ['syncConversation', 'getReadReceipts'])
  poller.stop()
})

test('failed receipt batches stay bounded and retry before rotating to later pending receipts', async () => {
  const r = fixture(), batches: string[][] = [], errors: Error[] = []
  const ids = Array.from({ length: 25 }, (_, index) => `sent-${index}`)
  r.wx.cloud.callFunction = async ({ data }) => {
    if (data.action === 'syncConversation') return syncPage(0)
    batches.push(Array.from(data.msgIds as string[]))
    if (batches.length === 1) throw Error('network')
    return response({ readIds: [] })
  }
  const poller = r.watch.pollMessages('bob', cursor(0), () => {}, error => errors.push(error), null,
    { pending: () => [...ids, ids[0]!], apply: () => {} })
  await r.poll(); await r.poll(); await r.poll()
  assert.equal(errors.length, 0)
  assert.ok(batches.every(batch => batch.length === 20 && new Set(batch).size === 20))
  assert.deepEqual(batches[0], batches[1], 'a failed receipt lookup remains pending rather than silently skipped')
  assert.equal(new Set(batches.flat()).size, 25)
  poller.stop()
})

test('stopping discards late sync success and failure without restoring page feedback', async () => {
  for (const fail of [false, true]) {
    const r = fixture(), sync = deferred<ReturnType<typeof response>>()
    let changes = 0, healthy = 0, errors = 0, requests = 0
    r.wx.cloud.callFunction = async () => { requests++; return sync.promise }
    const poller = r.watch.pollMessages('bob', cursor(0), () => { changes++ }, () => { errors++ }, null,
      { pending: () => ['sent-one'], apply: () => {}, healthy: () => { healthy++ } })
    await tick()
    poller.stop()
    if (fail) sync.reject(Error('network'))
    else sync.resolve(syncPage(1, [message(1)]))
    await tick()
    assert.equal(r.timers.size, 0)
    assert.deepEqual({ changes, healthy, errors, requests }, { changes: 0, healthy: 0, errors: 0, requests: 1 })
  }
})

test('same-owner session replacement invalidates an in-flight sync and stops its timer', async () => {
  const r = fixture(), sync = deferred<ReturnType<typeof response>>()
  let changes = 0, healthy = 0, errors = 0
  r.wx.cloud.callFunction = async () => sync.promise
  const poller = r.watch.pollMessages('bob', cursor(0), () => { changes++ }, () => { errors++ }, null,
    { pending: () => ['sent-one'], apply: () => {}, healthy: () => { healthy++ } })
  await tick()
  r.session.set({ ...profile, nickname: 'Updated Alice' })
  sync.resolve(syncPage(1, [message(1)]))
  await tick()
  assert.equal(r.timers.size, 0)
  assert.deepEqual({ changes, healthy, errors }, { changes: 0, healthy: 0, errors: 0 })
  poller.stop()
})

test('receipt replies cannot apply after a stop or same-owner session replacement', async () => {
  for (const changeSession of [false, true]) {
    const r = fixture(), receipt = deferred<ReturnType<typeof response>>()
    let applied = 0, healthy = 0, errors = 0
    r.wx.cloud.callFunction = async ({ data }) => data.action === 'syncConversation' ? syncPage(0) : receipt.promise
    const poller = r.watch.pollMessages('bob', cursor(0), () => {}, () => { errors++ }, null,
      { pending: () => ['sent-one'], apply: () => { applied++ }, healthy: () => { healthy++ } })
    await tick()
    assert.equal(healthy, 1)
    if (changeSession) r.session.set(profile)
    else poller.stop()
    receipt.resolve(response({ readIds: ['sent-one'] }))
    await tick()
    assert.deepEqual({ applied, healthy, errors }, { applied: 0, healthy: 1, errors: 0 })
    assert.equal(r.timers.size, 0)
    poller.stop()
  }
})

test('a change callback that stops the poller prevents subsequent healthy feedback and receipt requests', async () => {
  const r = fixture(), actions: string[] = []
  let healthy = 0
  r.wx.cloud.callFunction = async ({ data }) => { actions.push(String(data.action)); return syncPage(1, [message(1)]) }
  const poller = r.watch.pollMessages('bob', cursor(0), () => poller.stop(), () => {}, null,
    { pending: () => ['sent-one'], apply: () => {}, healthy: () => { healthy++ } })
  await tick()
  assert.equal(healthy, 0)
  assert.deepEqual(actions, ['syncConversation'])
  assert.equal(r.timers.size, 0)
})
