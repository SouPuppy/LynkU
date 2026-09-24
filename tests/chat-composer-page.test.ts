import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messagingRuntime } from './helpers/messaging-client-runtime'
import type { IMessage } from '../apps/miniprogram/typings/cloudbase'
import type { SendOperation } from '../apps/miniprogram/features/messaging/send-operations'
import type * as Drafts from '../apps/miniprogram/services/chat-drafts'

type Row = Record<string, unknown>
type Response = { result: { data: unknown; error?: string; code?: string } }
interface ChatPage {
  data: {
    inputText: string; inputLength: number; canSend: boolean; draftWarning: string
    pending: SendOperation[]; messages: IMessage[]; timeline: unknown[]
    identityReady: boolean; state: string; myOpenid: string
  }
  onLoad(options: Record<string, string>): void
  onShow(): void
  onHide(): void
  onUnload(): void
  onInput(event: { detail: { value: string } }): void
  onSend(): Promise<void>
  onEditSend(event: { currentTarget: { dataset: { id: string } } }): void
}
const profile = { _openid: 'alice', verified: true, nickname: 'Alice', avatar_url: '', role: 'user', email: '', profile_version: 0 }
const tick = () => new Promise(resolve => setImmediate(resolve))
const cursor = { version: 2, conversation_id: 'conversation', sequence: 0 }
const display = { selfVisibility: 'real', peerVisibility: 'real', peerName: 'Bob', peerAvatar: '', blockedHere: false }
const history = (): Response => ({ result: { data: { messages: [], hasMore: false, nextBefore: null, sync_cursor: cursor, display } } })
const message = (request: Row): IMessage => ({ _id: 'confirmed-message', msg_id: String(request.msg_id), from: 'alice', to: 'bob',
  content: String(request.content), status: 'sent', created_at: '2026-09-24T00:00:00.000Z', conversation_id: 'conversation', sync_sequence: 1 })

function fixture(storage?: Map<string, unknown>) {
  const runtime = messagingRuntime(), requests: Row[] = []
  if (storage) for (const [key, value] of storage) runtime.storage.set(key, structuredClone(value))
  const session = runtime.load<{ set(value: unknown): void; clear(): void }>('apps/miniprogram/services/session.ts')
  session.set(profile)
  const drafts = runtime.load<typeof Drafts>('apps/miniprogram/services/chat-drafts.ts')
  const handlers: { history?: () => Promise<Response>; send?: (request: Row) => Promise<Response> } = {}
  runtime.wx.cloud.callFunction = async ({ data }) => {
    requests.push(data)
    if (data.action === 'getConversation') return handlers.history ? handlers.history() : history()
    if (data.action === 'getConversationDisplay') return { result: { data: display } }
    if (data.action === 'syncConversation') return { result: { data: { messages: [], hasMore: false, nextCursor: data.cursor } } }
    if (data.action === 'getSendResult') return { result: { data: { result: null } } }
    if (data.action === 'getReadReceipts') return { result: { data: { readIds: [] } } }
    if (data.action === 'getUnreadMessageCount' || data.action === 'getUnreadNotificationCount') return { result: { data: { count: 0 } } }
    if (data.action === 'send' && handlers.send) return handlers.send(data)
    throw Error(`Unexpected fixture action ${String(data.action)}`)
  }
  runtime.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const page = runtime.page<ChatPage>()
  return { ...runtime, page, requests, handlers, session, drafts,
    open: async (options: Record<string, string> = { peer: 'bob', existing: '1' }) => {
      page.onLoad(options); page.onShow(); await tick(); await tick()
      assert.equal(page.data.state, 'loaded')
    },
    input: (value: string) => page.onInput({ detail: { value } }),
  }
}

test('an established chat persists exact composer text on input and restores it after leaving the page', async () => {
  const first = fixture(); await first.open()
  first.input('  这条还没有发\n第二行  ')
  assert.equal(first.drafts.createChatDraft('conversation').load(), '  这条还没有发\n第二行  ')
  first.page.onHide(); first.page.onUnload()
  const second = fixture(first.storage); await second.open()
  assert.equal(second.page.data.inputText, '  这条还没有发\n第二行  ')
  assert.equal(second.page.data.inputLength, second.page.data.inputText.length)
  assert.equal(second.page.data.canSend, true)
  assert.equal(second.requests.filter(request => request.action === 'send').length, 0)
  second.page.onUnload()
})

test('a new anonymous initiation never restores an established conversation draft', async () => {
  const r = fixture()
  r.drafts.createChatDraft('conversation').save('属于已有会话的草稿')
  await r.open({ anon_type: 'post', anon_id: 'same-source-post' })
  assert.equal(r.page.data.inputText, '')
  r.input('这次独立发起的新内容'); r.page.onUnload()
  assert.equal(r.drafts.createChatDraft('conversation').load(), '属于已有会话的草稿')
})

test('editing a rejected message cannot overwrite a composer that already contains new text', async () => {
  const r = fixture()
  r.storage.set('message_send_v1:alice:conversation', [{ id: 'rejected', text: '原来的失败消息', state: 'failed', error: '', errorCode: 'CONTENT_REJECTED' }])
  await r.open(); r.input('现在正在写的内容')
  r.page.onEditSend({ currentTarget: { dataset: { id: 'rejected' } } })
  assert.equal(r.page.data.inputText, '现在正在写的内容')
  assert.equal(r.page.data.pending.find(item => item.id === 'rejected')?.text, '原来的失败消息')
  assert.equal(r.drafts.createChatDraft('conversation').load(), '现在正在写的内容')
  assert.equal(r.requests.filter(request => request.action === 'send').length, 0)
  r.page.onUnload()
})

test('a rejected message is not removed when its text cannot be saved into the composer', async () => {
  const r = fixture()
  r.storage.set('message_send_v1:alice:conversation', [{ id: 'rejected', text: '失败后仍需保留', state: 'failed', error: '', errorCode: 'CONTENT_REJECTED' }])
  await r.open()
  const save = r.wx.setStorageSync
  r.wx.setStorageSync = (key, value) => {
    if (key.startsWith('message_composer_v1:')) throw Error('fixture draft storage failure')
    save(key, value)
  }
  r.page.onEditSend({ currentTarget: { dataset: { id: 'rejected' } } })
  assert.equal(r.page.data.inputText, '')
  assert.equal(r.page.data.pending.find(item => item.id === 'rejected')?.text, '失败后仍需保留')
  assert.equal(r.storage.has('message_send_v1:alice:conversation'), true)
  r.page.onUnload()
})

test('clearing an anonymous initiation edit cancels replacement and preserves the original rejected message', async () => {
  const r = fixture()
  r.storage.set('message_send_v1:alice:conversation', [{ id: 'rejected', text: '先前失败的内容', state: 'failed', error: '', errorCode: 'CONTENT_REJECTED' }])
  await r.open({ anon_type: 'post', anon_id: 'source-post' })
  r.page.onEditSend({ currentTarget: { dataset: { id: 'rejected' } } })
  assert.equal(r.page.data.inputText, '先前失败的内容')
  r.input(''); r.input('另外的一条新消息')
  r.handlers.send = async request => ({ result: { data: { status: 'sent', message: message(request) } } })
  await r.page.onSend()
  assert.equal(r.page.data.messages[0]?.content, '另外的一条新消息')
  assert.equal(r.page.data.pending.find(item => item.id === 'rejected')?.text, '先前失败的内容')
  r.page.onUnload()
})

test('a pending-operation storage failure keeps composer text and never transmits', async () => {
  const r = fixture(); await r.open(); r.input('请保留这条输入')
  const save = r.wx.setStorageSync
  r.wx.setStorageSync = (key, value) => {
    if (key.startsWith('message_send_v1:')) throw Error('fixture disk failure')
    save(key, value)
  }
  await r.page.onSend()
  assert.equal(r.page.data.inputText, '请保留这条输入')
  assert.equal(r.page.data.pending.length, 0)
  assert.equal(r.requests.filter(request => request.action === 'send').length, 0)
  assert.equal(r.drafts.createChatDraft('conversation').load(), '请保留这条输入')
  r.page.onUnload()
})

test('a composer deletion failure prevents transmission and keeps the original input visible', async () => {
  const r = fixture(); await r.open(); r.input('不能留在磁盘却看起来已经发送')
  const remove = r.wx.removeStorageSync
  r.wx.removeStorageSync = key => {
    if (key.startsWith('message_composer_v1:')) throw Error('fixture remove failure')
    remove(key)
  }
  await r.page.onSend()
  assert.equal(r.page.data.inputText, '不能留在磁盘却看起来已经发送')
  assert.equal(r.page.data.pending.length, 0)
  assert.equal(r.requests.filter(request => request.action === 'send').length, 0)
  assert.equal(r.drafts.createChatDraft('conversation').load(), '不能留在磁盘却看起来已经发送')
  r.page.onUnload()
})

test('confirming a send cannot clear new composer input typed while the request was in flight', async () => {
  const r = fixture(); await r.open(); r.input('第一条输入')
  let complete: (() => void) | undefined
  r.handlers.send = request => new Promise(resolve => { complete = () => resolve({ result: { data: { status: 'sent', message: message(request) } } }) })
  const sending = r.page.onSend(); await tick()
  assert.equal(r.drafts.createChatDraft('conversation').load(), '')
  assert.equal(r.page.data.inputText, '')
  r.input('等待期间写的第二条')
  complete!(); await sending; await tick()
  assert.equal(r.page.data.messages.length, 1)
  assert.equal(r.page.data.pending.length, 0)
  assert.equal(r.page.data.inputText, '等待期间写的第二条')
  assert.equal(r.drafts.createChatDraft('conversation').load(), '等待期间写的第二条')
  r.page.onUnload()
})

test('logout clears the private view and a delayed send result cannot restore its messages or composer', async () => {
  const r = fixture(); await r.open(); r.input('先发这条')
  let complete: (() => void) | undefined
  r.handlers.send = request => new Promise(resolve => { complete = () => resolve({ result: { data: { status: 'sent', message: message(request) } } }) })
  const sending = r.page.onSend(); await tick()
  assert.equal(r.page.data.inputText, '')
  assert.equal(r.page.data.pending.length, 1)
  r.input('后写的私人内容')
  r.session.clear()
  complete!(); await sending; await tick()
  assert.equal(r.page.data.inputText, '')
  assert.equal(r.page.data.myOpenid, '')
  assert.equal(r.page.data.messages.length, 0)
  assert.equal(r.page.data.pending.length, 0)
  assert.equal(r.page.data.timeline.length, 0)
  assert.equal(r.page.data.canSend, false)
  assert.equal(r.timers.size, 0)
  r.page.onHide(); r.page.onUnload()
})

test('foreground return restarts an interrupted initial load instead of staying in loading forever', async () => {
  const r = fixture()
  let finishFirst: (() => void) | undefined, calls = 0
  r.handlers.history = async () => {
    if (++calls === 1) return new Promise(resolve => { finishFirst = () => resolve(history()) })
    return history()
  }
  r.page.onLoad({ peer: 'bob', existing: '1' }); r.page.onShow(); await tick()
  assert.equal(r.page.data.state, 'loading')
  r.page.onHide(); finishFirst!(); await tick()
  r.page.onShow(); await tick(); await tick()
  assert.equal(calls, 2)
  assert.equal(r.page.data.state, 'loaded')
  assert.equal(r.page.data.identityReady, true)
  r.page.onUnload()
})

test('returning after a same-account profile update rebinds the chat without losing its target or composer', async () => {
  const r = fixture(); await r.open(); r.input('同账号返回仍需保留')
  r.page.onHide()
  r.session.set({ ...profile, nickname: 'Updated name' })
  r.page.onShow(); await tick(); await tick()
  assert.equal(r.page.data.state, 'loaded')
  assert.equal(r.page.data.identityReady, true)
  assert.equal(r.page.data.inputText, '同账号返回仍需保留')
  assert.equal(r.page.data.canSend, true)
  assert.equal(r.requests.filter(request => request.action === 'getConversationDisplay').length, 1)
  r.page.onUnload()
})
