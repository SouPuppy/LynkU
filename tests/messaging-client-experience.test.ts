import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messagingRuntime } from './helpers/messaging-client-runtime'
import type { IMessage } from '../apps/miniprogram/typings/cloudbase'
import type * as SendRecovery from '../apps/miniprogram/services/send-recovery'
const tick = () => new Promise(resolve => setImmediate(resolve))
const profile = { _openid: 'alice', verified: true, nickname: 'Alice', avatar_url: '', role: 'user', email: '', profile_version: 0 }
function signedIn() {
  const runtime = messagingRuntime()
  const session = runtime.load<{ set(value: unknown): void; clear(): void }>('apps/miniprogram/services/session.ts')
  session.set(profile)
  return { ...runtime, session }
}

test('new summary refresh invalidates a delayed count instead of restoring an already cleared red dot', async () => {
  const r = signedIn()
  let resolveOld: ((value: { result: { data: { count: number } } }) => void) | undefined
  let calls = 0
  r.wx.cloud.callFunction = async ({ data }) => {
    if (data.action === 'getUnreadMessageCount' && ++calls === 1) return new Promise(resolve => { resolveOld = resolve })
    return { result: { data: { count: 0 } } }
  }
  const badge = r.load<{ refreshMessageBadge(): Promise<number> }>('apps/miniprogram/services/badge.ts')
  const old = badge.refreshMessageBadge()
  await tick()
  const next = badge.refreshMessageBadge()
  resolveOld!({ result: { data: { count: 6 } } })
  await Promise.all([old, next])
  assert.equal(calls, 2)
  assert.deepEqual(r.badgeWrites, ['0'])
})

test('notification read failures persist per owner, flush later, and cannot write for a signed-out account', async () => {
  const r = signedIn(), requests: string[][] = []
  let failed = true
  r.wx.cloud.callFunction = async ({ data }) => {
    requests.push(data.notificationIds as string[])
    if (failed) throw Error('network')
    return { result: { data: { updated: 1 } } }
  }
  const service = r.load<{ markNotificationsRead(ids: string[]): Promise<number>; flushNotificationReads(): Promise<void> }>('apps/miniprogram/services/notifications.ts')
  await assert.rejects(service.markNotificationsRead(['n1']))
  assert.ok(r.storage.has('notification_reads_v1:alice'))
  r.session.clear()
  await service.flushNotificationReads()
  assert.equal(requests.length, 1)
  r.session.set(profile); failed = false
  await service.flushNotificationReads()
  assert.equal(requests.length, 2)
  assert.equal(r.storage.has('notification_reads_v1:alice'), false)
})

test('a provisional anonymous send remains recoverable after process restart with the original initiation and message id', async () => {
  const first = signedIn(), conversation = 'c'.repeat(64)
  const target = { anonymous: true as const, type: 'user' as const, id: 'bob-user', initiation_id: 'i'.repeat(24), initiator_visibility: 'anonymous' as const }
  first.wx.cloud.callFunction = async () => { throw Error('network reply lost') }
  const service = first.load<typeof SendRecovery>('apps/miniprogram/services/send-recovery.ts')
  const operation = service.createSendRecovery(conversation, undefined, target, () => true, () => {}, () => {}, 'Bob')
  await operation.submit('stable-request', 'body')
  assert.equal(service.listPendingConversations()[0]?.target && 'initiation_id' in service.listPendingConversations()[0]!.target!, true)
  const second = signedIn()
  for (const [key, value] of first.storage) second.storage.set(key, structuredClone(value))
  let lookups = 0, confirms = 0
  second.wx.cloud.callFunction = async ({ data }) => {
    assert.equal(data.action, 'getSendResult')
    assert.equal((data.anonymous_target as { initiation_id: string }).initiation_id, target.initiation_id)
    assert.equal(data.msg_id, 'stable-request'); lookups++
    return { result: { data: { result: { status: 'duplicate', message: { ...message(1), from: 'alice', to: 'bob-user', content: 'body', msg_id: 'stable-request', conversation_id: conversation } } } } }
  }
  const resumedService = second.load<typeof SendRecovery>('apps/miniprogram/services/send-recovery.ts')
  const saved = resumedService.listPendingConversations()[0]!
  const resumed = resumedService.createSendRecovery(saved.id, saved.peer || undefined, saved.target, () => true, () => {}, () => { confirms++ }, saved.name)
  await resumed.recover()
  assert.equal(lookups, 1); assert.equal(confirms, 1)
  assert.equal(resumedService.listPendingConversations().length, 0)
})

interface ChatPage {
  data: { messages: IMessage[]; chatTitle: string; selfAnonymous: boolean; identityNote: string; scrollTo: string; newMessages: number; pollingActive: boolean }
  _nearBottom: boolean
  onLoad(options: Record<string, string>): void
  onShow(): void
  onHide(): void
}
const cursor = (sequence: number) => ({ version: 2, conversation_id: 'conversation', sequence })
const message = (sequence: number): IMessage => ({ _id: `m${sequence}`, msg_id: `r${sequence}`, from: 'bob-user', to: 'alice', content: 'hello',
  status: 'sent', created_at: '2026-09-23T00:00:00.000Z', conversation_id: 'conversation', sync_sequence: sequence })

test('old cloud history without identity is identified safely and initial retry reloads the whole conversation', async () => {
  const r = signedIn(); let updated = false, historyCalls = 0
  r.wx.cloud.callFunction = async ({ data }) => {
    if (data.action === 'getConversation') {
      historyCalls++
      return { result: { data: { messages: [], hasMore: false, nextBefore: null, sync_cursor: cursor(0),
        ...(updated ? { display: { selfVisibility: 'anonymous', peerVisibility: 'real', peerName: 'Bob', peerAvatar: '', blockedHere: false } } : {}),
      } } }
    }
    if (data.action === 'syncConversation') return { result: { data: { messages: [], hasMore: false, nextCursor: cursor(0) } } }
    throw Error(`Unexpected action ${String(data.action)}`)
  }
  r.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const page = r.page<ChatPage & { data: { state: string; loadError: string; identityReady: boolean }; onIdentityRetry(): void }>()
  page.onLoad({ peer: 'bob-user', existing: '1' }); page.onShow(); await tick()
  assert.equal(page.data.state, 'error'); assert.equal(page.data.identityReady, false)
  assert.equal(page.data.loadError, '聊天服务正在更新，请稍后再试')
  assert.equal(r.timers.size, 0)
  updated = true; page.onIdentityRetry(); await tick(); await tick()
  assert.equal(historyCalls, 2); assert.equal(page.data.state, 'loaded')
  assert.equal(page.data.identityReady, true); assert.equal(page.data.selfAnonymous, true)
  assert.equal(page.data.loadError, ''); page.onHide()
})

test('chat uses server directional identity, reads only visible messages, and retains history position on foreground return', async () => {
  const r = signedIn(), readIds: string[] = []
  let historyCalls = 0, latest = 1, failSync = false
  r.wx.cloud.callFunction = async ({ data }) => {
    if (data.action === 'getConversationDisplay') return { result: { data: { selfVisibility: 'anonymous', peerVisibility: 'real', peerName: 'Bob', peerAvatar: '', blockedHere: false } } }
    if (data.action === 'getConversation') {
      historyCalls++
      return { result: { data: { messages: [message(1)], hasMore: false, nextBefore: null, sync_cursor: cursor(1),
        display: { selfVisibility: 'anonymous', peerVisibility: 'real', peerName: 'Bob', peerAvatar: '', blockedHere: false } } } }
    }
    if (data.action === 'syncConversation') {
      if (failSync) throw Error('network')
      const after = (data.cursor as { sequence: number }).sequence
      return { result: { data: { messages: latest > after ? [message(latest)] : [], hasMore: false, nextCursor: cursor(latest) } } }
    }
    if (data.action === 'markRead') { readIds.push(...data.msgIds as string[]); return { result: { data: { updated: 1 } } } }
    if (data.action === 'getUnreadMessageCount' || data.action === 'getUnreadNotificationCount') return { result: { data: { count: 0 } } }
    throw Error(`Unexpected ${String(data.action)}`)
  }
  r.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const page = r.page<ChatPage>()
  page.onLoad({ peer: 'bob-user', existing: '1' }); page.onShow()
  await tick(); await tick()
  assert.equal(page.data.chatTitle, 'Bob')
  assert.equal(page.data.selfAnonymous, true)
  assert.equal(page.data.identityNote, '你以匿名身份参与')
  assert.equal(readIds.length, 0)
  r.see('.message-row', 'm1'); await tick(); await tick()
  assert.deepEqual(readIds, ['m1'])
  page._nearBottom = false; page.data.scrollTo = 'msg-m1'; latest = 2
  await [...r.timers.values()][0]!()
  assert.equal(page.data.scrollTo, 'msg-m1')
  assert.equal(page.data.newMessages, 1)
  assert.deepEqual(readIds, ['m1'])
  failSync = true; await [...r.timers.values()][0]!()
  assert.equal(page.data.pollingActive, false)
  await [...r.timers.values()][0]!()
  assert.equal(page.data.pollingActive, true)
  failSync = false; await [...r.timers.values()][0]!()
  assert.equal(page.data.pollingActive, false)
  page.onHide(); assert.equal(r.timers.size, 0)
  page.onShow(); await tick(); await tick()
  assert.equal(historyCalls, 1)
  assert.equal(page.data.messages.length, 2)
  assert.equal(page.data.scrollTo, 'msg-m1')
  page.onHide()
})

interface Inbox {
  data: { conversations: unknown[]; notifications: unknown[]; activeTab: string }
  onShow(): void; onHide(): void; onTabNotif(): Promise<void>; onChatRetryFailed(): void
}

test('a refresh queued behind an older directory response cannot restore stale unread counts', async () => {
  const r = signedIn()
  let finishOld: (() => void) | undefined, reads = 0
  const directory = (unreadCount: number) => ({ result: { data: { conversations: [{
    peer: { _openid: 'bob-user', nickname: 'Bob', avatar_url: '' },
    lastMessage: { _id: 'm1', content: 'hello', created_at: '2026-09-23T00:00:00.000Z' }, unreadCount,
  }], hasMore: false, nextCursor: null } } })
  r.wx.cloud.callFunction = async ({ data }) => {
    if (data.action === 'listConversations') {
      reads++
      if (reads === 1) return new Promise(resolve => { finishOld = () => resolve(directory(6)) })
      return directory(0)
    }
    return { result: { data: { count: 0 } } }
  }
  r.load('apps/miniprogram/pages/messages/messages.ts')
  const page = r.page<Inbox & { loadConversations(): Promise<void> }>()
  page.onShow(); await tick()
  await page.loadConversations()
  finishOld!(); await tick(); await tick()
  assert.equal(reads, 2)
  assert.equal((page.data.conversations[0] as { unreadCount: number }).unreadCount, 0)
  page.onHide()
})
test('a resident empty inbox receives its first conversation and cached notification tab refreshes again', async () => {
  const r = signedIn()
  let arrived = false, notificationReads = 0, directoryReads = 0
  r.wx.cloud.callFunction = async ({ data }) => {
    if (data.action === 'listConversations') {
      directoryReads++
      return { result: { data: { conversations: arrived ? [{ peer: { _openid: 'bob-user', nickname: 'Bob', avatar_url: '' },
        lastMessage: { _id: 'm1', content: 'hello', created_at: '2026-09-23T00:00:00.000Z' }, unreadCount: 1 }] : [], hasMore: false, nextCursor: null } } }
    }
    if (data.action === 'listNotifications') { notificationReads++; return { result: { data: { notifications: [], hasMore: false, nextCursor: null } } } }
    return { result: { data: { count: arrived ? 1 : 0 } } }
  }
  r.load('apps/miniprogram/pages/messages/messages.ts')
  const page = r.page<Inbox>(); page.onShow(); await tick(); await tick()
  assert.equal(page.data.conversations.length, 0)
  arrived = true
  await r.load<{ refreshMessageBadge(): Promise<number> }>('apps/miniprogram/services/badge.ts').refreshMessageBadge()
  await tick()
  assert.equal(page.data.conversations.length, 1)
  await page.onTabNotif(); page.data.activeTab = 'chat'; await page.onTabNotif()
  assert.equal(notificationReads, 2)
  const before = directoryReads; page.onHide()
  await r.load<{ refreshMessageBadge(): Promise<number> }>('apps/miniprogram/services/badge.ts').refreshMessageBadge()
  assert.equal(directoryReads, before)
})
