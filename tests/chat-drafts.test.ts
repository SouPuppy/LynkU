import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messagingRuntime } from './helpers/messaging-client-runtime'
import type * as Drafts from '../apps/miniprogram/services/chat-drafts'

const profile = { _openid: 'alice', verified: true, nickname: 'Alice', avatar_url: '', role: 'user', email: '', profile_version: 0 }
function signedIn() {
  const runtime = messagingRuntime()
  const session = runtime.load<{ set(value: unknown): void; clear(): void }>('apps/miniprogram/services/session.ts')
  session.set(profile)
  const drafts = runtime.load<typeof Drafts>('apps/miniprogram/services/chat-drafts.ts')
  return { ...runtime, session, ...drafts }
}

test('composer drafts retain exact text across page handles and stay separate by established conversation', () => {
  const r = signedIn()
  r.createChatDraft('direct-chat').save('  两行\n草稿  ')
  r.createChatDraft('anonymous-thread-1').save('第一次匿名会话')
  assert.equal(r.createChatDraft('direct-chat').load(), '  两行\n草稿  ')
  assert.equal(r.createChatDraft('anonymous-thread-1').load(), '第一次匿名会话')
  assert.equal(r.createChatDraft('anonymous-thread-2').load(), '')
  assert.throws(() => r.createChatDraft({ type: 'post', id: 'same-post', initiation_id: 'new' }))
  assert.throws(() => r.createChatDraft(''))
})

test('logout invalidates old draft handles and another account cannot restore or overwrite the previous account', () => {
  const r = signedIn(), alice = r.createChatDraft('shared-conversation')
  alice.save('Alice 私人内容')
  r.session.clear()
  assert.throws(() => alice.load(), /会话已变更/)
  assert.throws(() => alice.save('迟到的页面写入'), /会话已变更/)
  assert.throws(() => alice.remove(), /会话已变更/)
  assert.throws(() => r.createChatDraft('shared-conversation'), /会话已变更/)
  r.session.set({ ...profile, _openid: 'bob' })
  const bob = r.createChatDraft('shared-conversation')
  assert.equal(bob.load(), '')
  bob.save('Bob 私人内容')
  r.session.set(profile)
  assert.throws(() => alice.save('same account, old revision'), /会话已变更/)
  assert.equal(r.createChatDraft('shared-conversation').load(), 'Alice 私人内容')
  assert.throws(() => bob.load(), /会话已变更/)
})

test('a profile revision also invalidates a composer handle, while a newly bound handle restores its draft', () => {
  const r = signedIn(), draft = r.createChatDraft('conversation')
  draft.save('still mine')
  r.session.set({ ...profile, nickname: 'New name' })
  assert.throws(() => draft.remove(), /会话已变更/)
  assert.equal(r.createChatDraft('conversation').load(), 'still mine')
  r.session.set({ ...profile, verified: false })
  assert.throws(() => r.createChatDraft('conversation'), /会话已变更/)
})

test('accepted sends and manually cleared input remove only the matching composer draft', () => {
  const r = signedIn(), first = r.createChatDraft('first'), second = r.createChatDraft('second')
  first.save('first text'); second.save('second text')
  first.remove()
  assert.equal(first.load(), '')
  assert.equal(second.load(), 'second text')
  second.save('')
  assert.equal(second.load(), '')
  assert.equal(r.storage.has('message_composer_v1:alice'), false)
})

test('oversize and malformed input cannot replace an already saved draft', () => {
  const r = signedIn(), draft = r.createChatDraft('conversation')
  draft.save('x'.repeat(5000))
  assert.throws(() => draft.save('x'.repeat(5001)), /5000/)
  assert.throws(() => draft.save({ text: 'bad type' }))
  assert.equal(draft.load().length, 5000)
})

test('storage failures remain explicit and leave previously saved drafts intact', () => {
  const r = signedIn(), draft = r.createChatDraft('conversation')
  draft.save('previous safe copy')
  const set = r.wx.setStorageSync, remove = r.wx.removeStorageSync, get = r.wx.getStorageSync
  r.wx.setStorageSync = () => { throw Error('disk full with private details') }
  assert.throws(() => draft.save('new input'), /未发送内容暂未保存/)
  assert.equal(draft.load(), 'previous safe copy')
  r.wx.setStorageSync = set
  r.wx.removeStorageSync = () => { throw Error('disk locked') }
  assert.throws(() => draft.remove(), /未发送内容暂未保存/)
  assert.equal(draft.load(), 'previous safe copy')
  r.wx.removeStorageSync = remove
  r.wx.getStorageSync = () => { throw Error('private disk details') }
  assert.throws(() => draft.load(), /未发送内容暂时无法读取/)
  r.wx.getStorageSync = get
})

test('malformed disk contents are rejected without silently erasing the recoverable data', () => {
  const invalid: unknown[] = [[], { version: 2, drafts: [] }, { version: 1, drafts: [{ conversation: 'chat', text: 1 }] },
    { version: 1, drafts: [{ conversation: 'chat', text: 'one' }, { conversation: 'chat', text: 'two' }] },
    { version: 1, drafts: [{ conversation: 'chat', text: 'x'.repeat(5001) }] }]
  for (const value of invalid) {
    const r = signedIn(), draft = r.createChatDraft('chat')
    r.storage.set('message_composer_v1:alice', value)
    assert.throws(() => draft.load(), /未发送内容暂时无法读取/)
    assert.throws(() => draft.save('new'), /未发送内容暂时无法读取/)
    assert.equal(r.storage.get('message_composer_v1:alice'), value)
  }
})

test('bounded draft storage rejects overflow without evicting other unsent messages', () => {
  const r = signedIn()
  for (let index = 0; index < 50; index++) r.createChatDraft(`chat-${index}`).save(`unsent-${index}`)
  assert.throws(() => r.createChatDraft('chat-50').save('overflow'), /未发送内容较多/)
  r.createChatDraft('chat-0').save('updated')
  assert.equal(r.createChatDraft('chat-0').load(), 'updated')
  assert.equal(r.createChatDraft('chat-49').load(), 'unsent-49')
  r.createChatDraft('chat-1').remove()
  r.createChatDraft('chat-50').save('now fits')
  assert.equal(r.createChatDraft('chat-50').load(), 'now fits')
})
