import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SendOperations, parseStoredSendOperations, type SendOperation, type SendOperationPorts } from '../apps/miniprogram/features/messaging/send-operations'
import { messagingRuntime } from './helpers/messaging-client-runtime'
import type * as SendRecovery from '../apps/miniprogram/services/send-recovery'

type Message = { msg_id: string }
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
function fixture(overrides: Partial<SendOperationPorts<Message>> = {}, restored: SendOperation[] = []) {
  let saved: SendOperation[] = [], warnings = 0
  const states: SendOperation[][] = [], confirmations: Message[] = [], sends: [string, string][] = []
  const controller = new SendOperations<Message>({
    valid: () => true, now: () => 1234, save: items => { saved = structuredClone(items) },
    storageFailed: () => { warnings++ }, changed: items => { states.push(structuredClone(items)) },
    confirmed: message => { confirmations.push(message) }, lookup: async () => null,
    send: async (id, text) => { sends.push([id, text]); return { msg_id: id } }, ...overrides,
  }, restored)
  return { controller, states, confirmations, sends, saved: () => saved, warnings: () => warnings }
}
const pending = (state = 'uncertain', code?: string) => parseStoredSendOperations([
  { id: 'stable', text: 'frozen text', state, error: 'untrusted server error', errorCode: code, submittedAt: 40, order: 3 },
], 100)

test('submissions persist stable ordering and immutable text before dispatch even when responses arrive out of order', async () => {
  const first = deferred<Message>(), second = deferred<Message>(), requests: [string, string][] = []
  const f = fixture({ now: () => 1234, send: (id, text) => { requests.push([id, text]); return id === 'first' ? first.promise : second.promise } })
  const one = f.controller.submit('first', 'one'), two = f.controller.submit('second', 'two')
  assert.deepEqual(f.saved().map(item => [item.id, item.submittedAt, item.order, item.state]), [
    ['first', 1234, 0, 'sending'], ['second', 1234, 1, 'sending'],
  ])
  const snapshot = f.controller.snapshot(); snapshot[0]!.text = 'mutated composer'
  await f.controller.submit('first', 'duplicate')
  assert.deepEqual(requests, [['first', 'one'], ['second', 'two']])
  second.resolve({ msg_id: 'second' }); await two
  assert.equal(f.controller.snapshot()[0]?.text, 'one')
  assert.equal(f.controller.snapshot()[0]?.order, 0)
  first.resolve({ msg_id: 'first' }); await one
  assert.deepEqual(f.controller.snapshot(), [])
  assert.deepEqual(f.confirmations.map(item => item.msg_id), ['second', 'first'])
})

test('lost send response recovers by lookup and never causes an automatic retransmission', async () => {
  let sends = 0, found: Message | null = null
  const f = fixture({ send: async id => { sends++; found = { msg_id: id }; throw Object.assign(Error('private SDK details'), { code: 'NETWORK_ERROR' }) },
    lookup: async () => found })
  await f.controller.submit('stable', 'body')
  assert.equal(f.controller.snapshot()[0]?.state, 'uncertain')
  assert.equal(f.controller.snapshot()[0]?.action, 'retry')
  assert.equal(f.controller.snapshot()[0]?.error.includes('private'), false)
  await f.controller.recover()
  assert.equal(sends, 1)
  assert.equal(f.confirmations.length, 1)
  assert.deepEqual(f.saved(), [])
})

test('retry keeps one lock across lookup and send; repeated taps cannot edit or transmit twice', async () => {
  const lookup = deferred<Message | null>(), response = deferred<Message>()
  let lookups = 0, sends = 0
  const f = fixture({ lookup: () => { lookups++; return lookup.promise },
    send: (id, text) => { sends++; assert.equal(id, 'stable'); assert.equal(text, 'frozen text'); return response.promise } }, pending())
  const retry = f.controller.retry('stable')
  assert.equal(f.controller.snapshot()[0]?.state, 'checking')
  await f.controller.retry('stable')
  assert.equal(f.controller.editFailed('stable'), null)
  assert.equal(f.controller.discard('stable'), false)
  assert.equal(lookups, 1)
  lookup.resolve(null); await tick()
  assert.equal(f.controller.snapshot()[0]?.state, 'sending')
  await f.controller.retry('stable'); await f.controller.recover()
  assert.equal(sends, 1)
  response.resolve({ msg_id: 'stable' }); await retry
  assert.equal(f.confirmations.length, 1)
})

test('sync confirmation during retry lookup prevents transmission and late lookup cannot restore a pending row', async () => {
  for (const outcome of ['absent', 'failed', 'found'] as const) {
    const lookup = deferred<Message | null>()
    const f = fixture({ lookup: () => lookup.promise }, pending())
    const retry = f.controller.retry('stable')
    f.controller.accept({ msg_id: 'stable' }); f.controller.accept({ msg_id: 'stable' })
    if (outcome === 'failed') lookup.reject(Error('late failure'))
    else lookup.resolve(outcome === 'found' ? { msg_id: 'stable' } : null)
    await retry
    assert.equal(f.sends.length, 0)
    assert.equal(f.confirmations.length, 1)
    assert.deepEqual(f.controller.snapshot(), [])
    assert.deepEqual(f.states[f.states.length - 1], [])
  }
})

test('sync confirmation during send survives late rejection and late duplicate success', async () => {
  for (const outcome of ['failed', 'success'] as const) {
    const response = deferred<Message>()
    const f = fixture({ send: () => response.promise })
    const sending = f.controller.submit('stable', 'body')
    f.controller.accept({ msg_id: 'stable' })
    if (outcome === 'failed') response.reject(Object.assign(Error('late'), { code: 'FORBIDDEN' }))
    else response.resolve({ msg_id: 'stable' })
    await sending
    await f.controller.submit('stable', 'must not resend accepted id')
    assert.equal(f.confirmations.length, 1)
    assert.deepEqual(f.controller.snapshot(), [])
  }
})

test('recovery actions come from safe codes and do not depend on editable composer text', async () => {
  for (const [code, action] of [
    ['CONTENT_REJECTED', 'edit'], ['INVALID_INPUT', 'edit'], ['RATE_LIMITED', 'retry'],
    ['MODERATION_UNAVAILABLE', 'retry'], ['FORBIDDEN', 'none'], ['EMAIL_NOT_VERIFIED', 'none'],
    ['NOT_FOUND', 'none'], ['CONFLICT', 'none'],
  ] as const) {
    let lookups = 0, sends = 0
    const f = fixture({ send: async () => { sends++; throw { code, message: 'openid=secret' } },
      lookup: async () => { lookups++; return null } })
    await f.controller.submit('stable', 'body')
    const item = f.controller.snapshot()[0]!
    assert.equal(item.state, 'failed'); assert.equal(item.action, action); assert.equal(item.errorCode, code)
    assert.equal(item.error.includes('secret'), false)
    await f.controller.recover()
    assert.equal(lookups, 0)
    if (action !== 'retry') { await f.controller.retry('stable'); assert.equal(sends, 1); assert.equal(lookups, 0) }
    if (action === 'edit') assert.equal(f.controller.editFailed('stable'), 'body')
    else if (action === 'none') { assert.equal(f.controller.editFailed('stable'), null); assert.equal(f.controller.discard('stable'), true) }
  }
})

test('persisted failures stay failed after restart and unfinished checks restore as uncertain', async () => {
  const rows = parseStoredSendOperations([
    { id: 'blocked', text: 'one', state: 'failed', errorCode: 'FORBIDDEN', error: 'unsafe', action: 'retry', submittedAt: 50, order: 8 },
    { id: 'content', text: 'two', state: 'failed', errorCode: 'CONTENT_REJECTED', error: 'unsafe', submittedAt: 51, order: 9 },
    { id: 'checking', text: 'three', state: 'checking', error: 'unsafe', submittedAt: 52, order: 10 },
    { id: 'legacy', text: 'four', state: 'failed', error: 'legacy raw error' },
  ], 100)
  const f = fixture({}, rows)
  assert.deepEqual(f.controller.snapshot().map(item => [item.state, item.action, item.submittedAt, item.order]), [
    ['failed', 'none', 50, 8], ['failed', 'edit', 51, 9], ['uncertain', 'retry', 52, 10], ['failed', 'edit', 100, 3],
  ])
  assert.equal(f.controller.snapshot().some(item => item.error.includes('unsafe') || item.error.includes('legacy raw')), false)
  await f.controller.recover()
  assert.equal(f.sends.length, 0)
  assert.equal(f.controller.snapshot().filter(item => item.state === 'failed').length, 3)
})

test('malformed disk submissions fail closed without silently dropping or duplicating user text', () => {
  for (const stored of [
    [{ id: 'one', text: '', state: 'failed' }],
    [{ id: 'one', text: 'body', state: 'other' }],
    [{ id: 'same', text: 'first', state: 'sending' }, { id: 'same', text: 'second', state: 'sending' }],
  ]) assert.throws(() => parseStoredSendOperations(stored, 1), /待发送记录/)
})

test('unknown persisted timestamps and ordering cannot break Date rendering or safe local order allocation', async () => {
  const rows = parseStoredSendOperations([
    { id: 'huge-date', text: 'one', state: 'failed', submittedAt: 1e20, order: Infinity },
    { id: 'invalid-date', text: 'two', state: 'failed', submittedAt: NaN, order: -1 },
    { id: 'unsafe-order', text: 'three', state: 'failed', submittedAt: 10, order: Number.MAX_SAFE_INTEGER + 1 },
    { id: 'last-order', text: 'four', state: 'failed', submittedAt: 20, order: Number.MAX_SAFE_INTEGER },
  ], 1234)
  assert.deepEqual(rows.map(item => item.submittedAt), [1234, 1234, 10, 20])
  assert.deepEqual(rows.map(item => item.order), [0, 1, 2, Number.MAX_SAFE_INTEGER])
  for (const item of rows) assert.doesNotThrow(() => new Date(item.submittedAt).toISOString())
  const response = deferred<Message>(), f = fixture({ send: () => response.promise }, rows)
  const sending = f.controller.submit('next', 'five')
  const orders = f.controller.snapshot().map(item => item.order)
  assert.ok(orders.every(Number.isSafeInteger)); assert.equal(new Set(orders).size, 5)
  assert.equal(orders[4], 4)
  response.resolve({ msg_id: 'next' }); await sending
})

test('initial storage failure leaves no operation or network dispatch for a composer to clear', async () => {
  const f = fixture({ save: () => { throw Error('disk full') } })
  await assert.rejects(f.controller.submit('stable', 'keep composer'), /disk full/)
  assert.equal(f.sends.length, 0)
  assert.deepEqual(f.controller.snapshot(), [])
  assert.deepEqual(f.states, [])
})

test('storage failure after server confirmation cannot turn a sent message into uncertain or reject submit', async () => {
  let writes = 0
  const f = fixture({ save: () => { if (++writes > 1) throw Error('disk full') } })
  await f.controller.submit('stable', 'sent')
  assert.equal(f.confirmations.length, 1)
  assert.equal(f.warnings(), 1)
  assert.deepEqual(f.controller.snapshot(), [])
  assert.deepEqual(f.states[f.states.length - 1], [])
})

test('storage failure after unknown outcome retains the recoverable message and successful lookup still confirms', async () => {
  let writes = 0
  const f = fixture({ save: () => { if (++writes > 1) throw Error('disk full') },
    send: async () => { throw Error('lost reply') }, lookup: async () => ({ msg_id: 'stable' }) })
  await f.controller.submit('stable', 'body')
  assert.equal(f.controller.snapshot()[0]?.state, 'uncertain')
  await f.controller.recover()
  assert.equal(f.confirmations.length, 1)
  assert.deepEqual(f.controller.snapshot(), [])
  assert.ok(f.warnings() >= 1)
})

test('failed edit and discard preserve text until removal is persisted', () => {
  for (const [code, action] of [['CONTENT_REJECTED', 'edit'], ['FORBIDDEN', 'discard']] as const) {
    const f = fixture({ save: () => { throw Error('disk full') } }, pending('failed', code))
    assert.throws(() => action === 'edit' ? f.controller.editFailed('stable') : f.controller.discard('stable'), /disk full/)
    assert.equal(f.controller.snapshot()[0]?.text, 'frozen text')
    assert.equal(f.controller.snapshot()[0]?.state, 'failed')
  }
})

test('late responses after page or account invalidation publish no private state', async () => {
  let valid = true
  const response = deferred<Message>()
  const f = fixture({ valid: () => valid, send: () => response.promise })
  const sending = f.controller.submit('stable', 'body')
  const changesBefore = f.states.length
  valid = false; response.resolve({ msg_id: 'stable' }); await sending
  await f.controller.retry('stable'); await f.controller.recover()
  assert.equal(f.confirmations.length, 0); assert.equal(f.states.length, changesBefore)
  assert.equal(f.saved()[0]?.id, 'stable')
})

test('editing a failed first anonymous message replaces it atomically only after new submission is durable', async () => {
  let failStorage = true, requests = 0
  const response = deferred<Message>()
  const f = fixture({ save: () => { if (failStorage) throw Error('disk full') }, send: (id, text) => {
    requests++; assert.equal(id, 'replacement'); assert.equal(text, 'edited body'); return response.promise
  } }, pending('failed', 'CONTENT_REJECTED'))
  await assert.rejects(f.controller.submit('replacement', 'edited body', 'stable'), /disk full/)
  assert.equal(requests, 0)
  assert.deepEqual(f.controller.snapshot().map(item => [item.id, item.text, item.state]), [['stable', 'frozen text', 'failed']])
  failStorage = false
  const sending = f.controller.submit('replacement', 'edited body', 'stable')
  assert.deepEqual(f.controller.snapshot().map(item => [item.id, item.text, item.state]), [['replacement', 'edited body', 'sending']])
  assert.equal(requests, 1)
  response.resolve({ msg_id: 'replacement' }); await sending
  assert.equal(f.confirmations.length, 1)
  await assert.rejects(f.controller.submit('next', 'body', 'stable'), /状态已变化/)
})

const profile = { _openid: 'alice', verified: true, nickname: 'Alice', avatar_url: '', role: 'user', email: '', profile_version: 0 }
function signedIn() {
  const runtime = messagingRuntime()
  runtime.load<{ set(value: unknown): void }>('apps/miniprogram/services/session.ts').set(profile)
  return runtime
}
test('adapter index or record write failure cannot leave an undiscoverable new send', async () => {
  for (const prefix of ['message_pending_threads_v1:', 'message_send_v1:']) {
    const r = signedIn(), original = r.wx.setStorageSync
    let requests = 0
    r.wx.cloud.callFunction = async () => { requests++; throw Error('unexpected send') }
    r.wx.setStorageSync = (key, value) => {
      if (key.startsWith(prefix)) throw Error('disk full')
      original(key, value)
    }
    const service = r.load<typeof SendRecovery>('apps/miniprogram/services/send-recovery.ts')
    const controller = service.createSendRecovery('conversation', 'bob', null, () => true, () => {}, () => {})
    await assert.rejects(controller.submit('stable', 'body'), /disk full/)
    assert.equal(requests, 0)
    assert.equal(r.storage.has('message_send_v1:alice:conversation'), false)
    assert.equal(service.listPendingConversations().length, 0)
    assert.equal(controller.snapshot().length, 0)
  }
})

test('adapter preserves failed intent and ordering through a full process restart without checking or sending it', async () => {
  const first = signedIn()
  first.wx.cloud.callFunction = async () => ({ result: { data: null, error: 'server private details', code: 'CONTENT_REJECTED' } })
  const service = first.load<typeof SendRecovery>('apps/miniprogram/services/send-recovery.ts')
  const controller = service.createSendRecovery('conversation', 'bob', null, () => true, () => {}, () => {})
  await controller.submit('stable', 'body')
  const original = controller.snapshot()[0]!
  const second = signedIn()
  for (const [key, value] of first.storage) second.storage.set(key, structuredClone(value))
  let requests = 0
  second.wx.cloud.callFunction = async () => { requests++; throw Error('must not recover known rejection') }
  const resumed = second.load<typeof SendRecovery>('apps/miniprogram/services/send-recovery.ts')
    .createSendRecovery('conversation', 'bob', null, () => true, () => {}, () => {})
  const saved = resumed.snapshot()[0]!
  assert.equal(saved.state, 'failed'); assert.equal(saved.errorCode, 'CONTENT_REJECTED'); assert.equal(saved.action, 'edit')
  assert.equal(saved.submittedAt, original.submittedAt); assert.equal(saved.order, original.order)
  await resumed.recover()
  assert.equal(requests, 0)
  assert.equal(resumed.editFailed('stable'), 'body')
})

test('adapter migrates legacy pending records in place while keeping failed intent and anonymous initiation', async () => {
  const r = signedIn(), id = 'c'.repeat(64)
  const target = { anonymous: true, type: 'user', id: 'bob', initiation_id: 'i'.repeat(24), initiator_visibility: 'anonymous' }
  r.storage.set('message_pending_threads_v1:alice', [{ id, name: 'Bob', peer: '', target, preview: 'body', at: 90 }])
  r.storage.set('message_send_v1:alice:' + id, [{ id: 'stable', text: 'body', state: 'failed', error: 'unsafe raw message' }])
  const service = r.load<typeof SendRecovery>('apps/miniprogram/services/send-recovery.ts')
  const entry = service.listPendingConversations()[0]!
  const controller = service.createSendRecovery(id, undefined, entry.target, () => true, () => {}, () => {})
  const item = controller.snapshot()[0]!
  assert.equal(item.state, 'failed'); assert.equal(item.submittedAt, 90); assert.equal(item.order, 0)
  const stored = r.storage.get('message_send_v1:alice:' + id) as SendOperation[]
  assert.equal(stored[0]?.submittedAt, 90)
  assert.equal(service.listPendingConversations()[0]?.target && 'initiation_id' in service.listPendingConversations()[0]!.target!, true)
})
