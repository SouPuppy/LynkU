import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChatTimeline } from '../apps/miniprogram/features/messaging/chat-timeline'
import type { SendOperation } from '../apps/miniprogram/features/messaging/send-operations'
import type { PublicMessage } from '../packages/contracts/src/index'

const now = new Date(2026, 8, 24, 12, 34).getTime()
function operation(id: string, order: number, change: Partial<SendOperation> = {}): SendOperation {
  return { id, order, text: `body ${id}`, submittedAt: now + order, state: 'sending', error: '', errorCode: '', action: 'none', ...change }
}
function message(id: string, sequence: number, change: Partial<PublicMessage> = {}): PublicMessage {
  return { _id: `stored-${id}`, msg_id: id, from: 'alice', to: 'bob', content: `body ${id}`,
    status: 'sent', created_at: new Date(now).toISOString(), conversation_id: 'conversation', sync_sequence: sequence, ...change }
}

test('delayed acknowledgement keeps earlier pending content beside the later confirmed send with a stable row identity', () => {
  const timeline = new ChatTimeline(), first = operation('A', 1), second = operation('B', 2)
  const submitted = timeline.render([], [first, second], 'alice', now)
  assert.deepEqual(submitted.map(row => row.key), ['out-A', 'out-B'])
  assert.deepEqual(submitted.map(row => row.status), ['正在发送…', '正在发送…'])

  const secondConfirmed = timeline.render([message('B', 2)], [first], 'alice', now)
  assert.deepEqual(secondConfirmed.map(row => row.key), ['out-A', 'out-B'])
  assert.deepEqual(secondConfirmed.map(row => row.content), submitted.map(row => row.content))
  assert.equal(secondConfirmed[0]?.operationId, 'A')
  assert.equal(secondConfirmed[1]?.messageId, 'stored-B')
  assert.equal(secondConfirmed[1]?.status, '已发送')

  const bothConfirmed = timeline.render([message('B', 2), message('A', 1)], [], 'alice', now)
  assert.deepEqual(bothConfirmed.map(row => row.key), ['out-A', 'out-B'])
  assert.ok(bothConfirmed.every(row => row.operationId === '' && row.action === 'none'))
})

test('overlapping confirmed and pending snapshots render each own operation only once', () => {
  const timeline = new ChatTimeline(), pending = [operation('A', 1), operation('B', 2)]
  timeline.render([], pending, 'alice', now)
  const overlap = timeline.render([message('A', 1), message('B', 2)], pending, 'alice', now)
  assert.deepEqual(overlap.map(row => row.key), ['out-A', 'out-B'])
  assert.equal(new Set(overlap.map(row => row.key)).size, overlap.length)
  assert.ok(overlap.every(row => row.messageId && !row.operationId && row.status === '已发送'))
})

test('authoritative server acceptance order wins even when it differs from local submission order', () => {
  const timeline = new ChatTimeline(), first = operation('A', 1), second = operation('B', 2)
  timeline.render([], [first, second], 'alice', now)
  const pending = timeline.render([message('B', 1)], [first], 'alice', now)
  assert.deepEqual(pending.map(row => row.key), ['out-A', 'out-B'])

  const confirmed = timeline.render([message('A', 3), message('incoming', 2, { from: 'bob', to: 'alice' }), message('B', 1)], [], 'alice', now)
  assert.deepEqual(confirmed.map(row => row.messageId), ['stored-B', 'stored-incoming', 'stored-A'])
  assert.deepEqual(confirmed.filter(row => row.mine).map(row => row.key), ['out-B', 'out-A'])
})

test('an incoming message with the same request id cannot swallow a pending outgoing message', () => {
  const timeline = new ChatTimeline()
  const rows = timeline.render([message('shared', 1, { from: 'bob', to: 'alice', content: 'peer text' })],
    [operation('shared', 1, { text: 'my text' })], 'alice', now)
  assert.deepEqual(rows.map(row => row.key), ['in-stored-shared', 'out-shared'])
  assert.deepEqual(rows.map(row => [row.content, row.mine, row.operationId]), [['peer text', false, ''], ['my text', true, 'shared']])
})

test('restored pending order uses persisted submission order even when storage order and wall clock disagree', () => {
  const older = operation('A', 7, { submittedAt: now + 1000, state: 'uncertain', error: '发送结果未确认', action: 'retry' })
  const newer = operation('B', 8, { submittedAt: now - 1000, state: 'uncertain', error: '发送结果未确认', action: 'retry' })
  const beforeRestart = new ChatTimeline().render([], [older, newer], 'alice', now)
  const restored = new ChatTimeline().render([], [newer, older], 'alice', now)
  assert.deepEqual(restored, beforeRestart)
  assert.deepEqual(restored.map(row => row.operationId), ['A', 'B'])
})

test('after restart unranked confirmed history precedes unresolved submissions until the server proves their sequence', () => {
  const timeline = new ChatTimeline()
  const pending = operation('A', 1, { submittedAt: now - 60000, state: 'uncertain', error: '发送结果未确认', action: 'retry' })
  const restored = timeline.render([message('B', 2)], [pending], 'alice', now)
  assert.deepEqual(restored.map(row => row.key), ['out-B', 'out-A'], 'local time cannot reconstruct the rank of an already settled operation')
  const confirmed = timeline.render([message('B', 2), message('A', 1)], [], 'alice', now)
  assert.deepEqual(confirmed.map(row => row.key), ['out-A', 'out-B'], 'the acknowledged server sequence supplies the missing order')
})

test('confirmed own and incoming messages sharing a request id keep separate keys while the own pending row resolves', () => {
  const rows = new ChatTimeline().render([
    message('shared', 1, { _id: 'own-record' }),
    message('shared', 2, { _id: 'peer-record', from: 'bob', to: 'alice' }),
  ], [operation('shared', 1)], 'alice', now)
  assert.deepEqual(rows.map(row => row.key), ['out-shared', 'in-peer-record'])
  assert.deepEqual(rows.map(row => row.messageId), ['own-record', 'peer-record'])
  assert.ok(rows.every(row => row.operationId === ''))
})

test('own read receipts are displayed while incoming messages have no outgoing receipt or retry action', () => {
  const rows = new ChatTimeline().render([
    message('sent', 1), message('delivered', 2, { status: 'delivered' }), message('read', 3, { status: 'read' }),
    message('incoming', 4, { from: 'bob', to: 'alice', status: 'read' }),
  ], [], 'alice', now)
  assert.deepEqual(rows.map(row => row.status), ['已发送', '已送达', '已读', ''])
  assert.ok(rows.every(row => row.action === 'none' && row.tone === 'normal'))
})

test('message times retain exact minutes across midnight and year boundaries', () => {
  const at = (year: number, month: number, day: number, hour: number, minute: number) => new Date(year, month - 1, day, hour, minute).toISOString()
  const rows = new ChatTimeline().render([
    message('today', 1, { created_at: at(2026, 9, 24, 0, 3) }),
    message('yesterday', 2, { created_at: at(2026, 9, 23, 23, 59) }),
    message('january', 3, { created_at: at(2026, 1, 1, 8, 5) }),
    message('last-year', 4, { created_at: at(2025, 12, 31, 23, 59) }),
  ], [], 'alice', now)
  assert.deepEqual(rows.map(row => row.time), ['00:03', '09-23 23:59', '01-01 08:05', '2025-12-31 23:59'])
  const pending = operation('pending', 1, { submittedAt: new Date(2026, 8, 24, 0, 3).getTime() })
  assert.equal(new ChatTimeline().render([], [pending], 'alice', now)[0]?.time, '00:03')
})

test('pending states expose explicit actions without changing submitted content or row identity', () => {
  const timeline = new ChatTimeline(), content = 'first line\nsecond line'
  const variants: Partial<SendOperation>[] = [
    { state: 'sending', action: 'none' },
    { state: 'checking', action: 'none' },
    { state: 'uncertain', error: '发送结果未确认', action: 'retry' },
    { state: 'failed', error: '请修改内容', errorCode: 'CONTENT_REJECTED', action: 'edit' },
    { state: 'failed', error: '当前无法发送', errorCode: 'FORBIDDEN', action: 'none' },
  ]
  const rows = variants.map(change => timeline.render([], [operation('A', 1, { text: content, ...change })], 'alice', now)[0]!)
  assert.ok(rows.every(row => row.key === 'out-A' && row.content === content && row.operationId === 'A'))
  assert.deepEqual(rows.map(row => row.action), ['none', 'none', 'retry', 'edit', 'discard'])
  assert.deepEqual(rows.map(row => row.tone), ['pending', 'pending', 'pending', 'error', 'error'])
  assert.deepEqual(rows.slice(0, 2).map(row => row.status), ['正在发送…', '正在确认…'])
})
