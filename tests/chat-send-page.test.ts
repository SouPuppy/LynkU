import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messagingRuntime } from './helpers/messaging-client-runtime'
import type * as Session from '../apps/miniprogram/services/session'
import type { SendOperation } from '../apps/miniprogram/features/messaging/send-operations'
import type { ChatMessageView } from '../apps/miniprogram/features/messaging/chat-timeline'
import type { IMessage, IMessageSyncCursor, ISelfProfile } from '../apps/miniprogram/typings/cloudbase'

type Request = Record<string, unknown>
type Response = { result: { data: unknown } }
interface ChatPage {
  data: { state: string; identityReady: boolean; messages: IMessage[]; pending: SendOperation[]; timeline: ChatMessageView[];
    inputText: string; inputLength: number; canSend: boolean }
  onLoad(options: Record<string, string>): void
  onShow(): void
  onHide(): void
  onInput(event: { detail: { value: string } }): void
  onSend(): Promise<void>
  onRetrySend(event: { currentTarget: { dataset: { id: string } } }): void
  onEditSend(event: { currentTarget: { dataset: { id: string } } }): void
}
const profile: ISelfProfile = { _openid: 'alice', verified: true, nickname: 'Alice', avatar_url: '', role: 'user', email: '' }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const conversation = 'c'.repeat(64)
const cursor = (sequence: number): IMessageSyncCursor => ({ version: 2, conversation_id: conversation, sequence })
const response = (data: unknown): Response => ({ result: { data } })
const rejected = (code: string) => ({ result: { data: null, error: 'server detail must not become the action label', code } })
const tap = (id: string) => ({ currentTarget: { dataset: { id } } })
function sent(data: Request, sequence: number): IMessage {
  assert.equal(typeof data.msg_id, 'string'); assert.equal(typeof data.content, 'string')
  return { _id: `stored-${sequence}`, msg_id: data.msg_id as string, content: data.content as string, from: 'alice', to: 'bob',
    status: 'sent', created_at: '2026-09-24T01:00:00.000Z', conversation_id: conversation, sync_sequence: sequence }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function fixture() {
  const r = messagingRuntime(), calls: Request[] = [], toasts: string[] = []
  r.load<typeof Session>('apps/miniprogram/services/session.ts').set(profile)
  const handlers: {
    send: (data: Request) => Promise<Response>
    lookup: (data: Request) => Promise<Response>
    sync: (data: Request) => Promise<Response>
  } = {
    send: async () => { throw Error('unexpected send') },
    lookup: async () => response({ result: null }),
    sync: async data => response({ messages: [], hasMore: false, nextCursor: data.cursor }),
  }
  r.wx.showToast = (...args: unknown[]) => {
    const options = args[0]
    if (options && typeof options === 'object' && 'title' in options && typeof options.title === 'string') toasts.push(options.title)
  }
  r.wx.cloud.callFunction = async ({ data }) => {
    calls.push(data)
    switch (data.action) {
      case 'getConversation': return response({ messages: [], hasMore: false, nextBefore: null, sync_cursor: cursor(0),
        display: { selfVisibility: 'real', peerVisibility: 'real', peerName: 'Bob', peerAvatar: '', blockedHere: false } })
      case 'syncConversation': return handlers.sync(data)
      case 'getReadReceipts': return response({ readIds: [] })
      case 'getUnreadMessageCount': return response({ count: 0 })
      case 'send': return handlers.send(data)
      case 'getSendResult': return handlers.lookup(data)
      default: throw Error(`Unexpected action ${String(data.action)}`)
    }
  }
  r.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const page = r.page<ChatPage>()
  page.onLoad({ peer: 'bob', existing: '1' }); page.onShow()
  await tick()
  assert.equal(page.data.state, 'loaded'); assert.equal(page.data.identityReady, true)
  return { ...r, page, handlers, calls, toasts, input: (value: string) => page.onInput({ detail: { value } }),
    poll: async () => { const callback = [...r.timers.values()][0]; assert.ok(callback); await callback() } }
}

test('actual chat page renders one continuous timeline when B confirms before A', async () => {
  const f = await fixture(), first = deferred<Response>(), second = deferred<Response>(), sends: Request[] = []
  f.handlers.send = async data => { sends.push(data); return data.content === 'A' ? first.promise : second.promise }
  assert.equal(f.page.data.timeline.length, 0)
  f.input('A'); const sendingA = f.page.onSend()
  assert.equal(f.page.data.messages.length, 0)
  assert.equal(f.page.data.timeline.length, 1, 'the first pending message replaces the empty view immediately')
  f.input('B'); const sendingB = f.page.onSend()
  const keys = Array.from(f.page.data.timeline, row => row.key)
  assert.deepEqual(Array.from(f.page.data.timeline, row => row.content), ['A', 'B'])
  assert.equal(new Set(keys).size, 2)
  second.resolve(response({ status: 'sent', message: sent(sends[1]!, 2) }))
  await sendingB
  assert.deepEqual(Array.from(f.page.data.timeline, row => row.key), keys)
  assert.deepEqual(Array.from(f.page.data.timeline, row => row.content), ['A', 'B'])
  assert.equal(f.page.data.timeline.length, 2)
  assert.equal(f.page.data.pending.length, 1)
  assert.equal(f.page.data.messages.length, 1)
  first.resolve(response({ status: 'sent', message: sent(sends[0]!, 1) }))
  await sendingA
  assert.deepEqual(Array.from(f.page.data.timeline, row => row.key), keys)
  assert.equal(f.page.data.pending.length, 0)
  assert.equal(f.page.data.messages.length, 2)
  assert.equal(f.page.data.timeline.length, 2)
  f.page.onHide()
})

test('whitespace never enables the send button or creates a submission', async () => {
  const f = await fixture()
  for (const value of ['', '   ', '\n\t ', '\u3000']) {
    f.input(value)
    assert.equal(f.page.data.canSend, false)
    await f.page.onSend()
  }
  assert.equal(f.page.data.pending.length, 0)
  assert.equal(f.calls.filter(call => call.action === 'send').length, 0)
  f.input('  useful text  ')
  assert.equal(f.page.data.canSend, true)
  f.page.onHide()
})

test('retry keeps the same intent and original request id with either an empty or occupied composer', async () => {
  for (const draft of ['', 'a separate draft']) {
    const f = await fixture(), sends: Request[] = [], lookups: Request[] = []
    f.handlers.send = async data => { sends.push(data); return sends.length === 1 ? rejected('RATE_LIMITED') : response({ status: 'sent', message: sent(data, 1) }) }
    f.handlers.lookup = async data => { lookups.push(data); return response({ result: null }) }
    f.input('retry this message'); await f.page.onSend()
    const pending = f.page.data.pending[0]!
    assert.equal(pending.action, 'retry')
    assert.equal(f.page.data.timeline[0]?.action, 'retry')
    f.input(draft)
    f.page.onRetrySend(tap(pending.id))
    await tick()
    assert.equal(lookups.length, 1)
    assert.equal(sends.length, 2)
    assert.equal(sends[1]?.msg_id, sends[0]?.msg_id)
    assert.equal(sends[1]?.content, 'retry this message')
    assert.equal(f.page.data.inputText, draft, 'retry neither fills nor overwrites the composer')
    assert.equal(f.page.data.pending.length, 0)
    assert.equal(f.page.data.timeline.length, 1)
    f.page.onHide()
  }
})

test('explicit edit protects occupied input and durably transfers rejected text before a new submission', async () => {
  const f = await fixture(), sends: Request[] = []
  f.handlers.send = async data => { sends.push(data); return sends.length === 1 ? rejected('CONTENT_REJECTED') : response({ status: 'sent', message: sent(data, 1) }) }
  f.input('rejected content'); await f.page.onSend()
  const rejectedId = f.page.data.pending[0]!.id
  assert.equal(f.page.data.timeline[0]?.action, 'edit')
  f.input('keep this draft'); f.page.onEditSend(tap(rejectedId))
  assert.equal(f.page.data.inputText, 'keep this draft')
  assert.equal(f.page.data.pending[0]?.id, rejectedId)
  assert.equal(f.toasts[f.toasts.length - 1], '请先处理输入框中的内容')
  f.input(''); f.page.onEditSend(tap(rejectedId))
  assert.equal(f.page.data.inputText, 'rejected content')
  assert.equal(f.page.data.canSend, true)
  assert.equal(f.page.data.pending.length, 0)
  assert.equal(sends.length, 1, 'editing alone never dispatches')
  const saved: unknown = f.storage.get('message_composer_v1:alice')
  assert.equal(JSON.stringify(saved), JSON.stringify({ version: 1, drafts: [{ conversation, text: 'rejected content' }] }))
  f.input('revised content'); await f.page.onSend()
  assert.equal(sends.length, 2)
  assert.notEqual(sends[1]?.msg_id, rejectedId)
  assert.equal(sends[1]?.content, 'revised content')
  assert.equal(f.page.data.inputText, '')
  assert.equal(f.page.data.pending.length, 0)
  assert.equal(f.page.data.timeline[0]?.content, 'revised content')
  assert.equal(f.page.data.timeline[0]?.status, '已发送')
  assert.equal(f.storage.has('message_composer_v1:alice'), false)
  f.page.onHide()
})

test('failed draft storage during explicit edit preserves the rejected operation and its text', async () => {
  const f = await fixture()
  f.handlers.send = async () => rejected('CONTENT_REJECTED')
  f.input('keep rejected content'); await f.page.onSend()
  const rejectedId = f.page.data.pending[0]!.id, write = f.wx.setStorageSync
  f.wx.setStorageSync = (key, value) => { if (key === 'message_composer_v1:alice') throw Error('disk unavailable'); write(key, value) }
  f.page.onEditSend(tap(rejectedId))
  assert.equal(f.page.data.inputText, '')
  assert.equal(f.page.data.pending[0]?.id, rejectedId)
  assert.equal(f.page.data.pending[0]?.text, 'keep rejected content')
  assert.equal(f.page.data.timeline[0]?.action, 'edit')
  assert.equal(f.calls.filter(call => call.action === 'send').length, 1)
  assert.equal(f.toasts[f.toasts.length - 1], '发送状态暂未保存，请重试')
  f.wx.setStorageSync = write
  f.page.onHide()
})

test('failed durable submission retains both composer text and its saved draft without dispatching', async () => {
  const f = await fixture(), write = f.wx.setStorageSync
  f.input('keep my unsent text')
  f.wx.setStorageSync = (key, value) => { if (key.startsWith('message_send_v1:')) throw Error('disk unavailable'); write(key, value) }
  await f.page.onSend()
  assert.equal(f.page.data.inputText, 'keep my unsent text')
  assert.equal(f.page.data.pending.length, 0)
  assert.equal(f.page.data.timeline.length, 0)
  assert.equal(f.calls.filter(call => call.action === 'send').length, 0)
  assert.equal(JSON.stringify(f.storage.get('message_composer_v1:alice')),
    JSON.stringify({ version: 1, drafts: [{ conversation, text: 'keep my unsent text' }] }))
  f.wx.setStorageSync = write
  f.page.onHide()
})

test('a live incoming message sharing the pending request id does not acknowledge the outgoing send', async () => {
  const f = await fixture(), reply = deferred<Response>()
  let request: Request | undefined
  f.handlers.send = async data => { request = data; return reply.promise }
  f.input('my pending message'); const sending = f.page.onSend()
  assert.ok(request)
  const incoming = { ...sent(request, 1), _id: 'incoming-message', from: 'bob', to: 'alice', content: 'peer message' }
  f.handlers.sync = async () => response({ messages: [incoming], hasMore: false, nextCursor: cursor(1) })
  await f.poll()
  assert.equal(f.page.data.pending.length, 1)
  assert.equal(f.page.data.messages.length, 1)
  assert.equal(f.page.data.timeline.length, 2)
  assert.deepEqual(Array.from(f.page.data.timeline, row => row.content), ['peer message', 'my pending message'])
  reply.resolve(response({ status: 'sent', message: sent(request, 2) }))
  await sending
  assert.equal(f.page.data.pending.length, 0)
  assert.equal(f.page.data.messages.length, 2)
  assert.equal(f.page.data.timeline.length, 2)
  f.page.onHide()
})
