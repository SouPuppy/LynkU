import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as avatars from '../packages/contracts/src/avatar'
import { parseConversationDisplay } from '../packages/contracts/src/message-history'
import { messagingRuntime } from './helpers/messaging-client-runtime'

const profile = { _openid: 'alice', nickname: 'Alice', avatar_url: avatars.DEFAULT_AVATAR,
  profile_version: 0, role: 'user', email: '', verified: false }
const select = (src: string) => ({ currentTarget: { dataset: { src } } })
type Profile = typeof profile & { avatar_url: string }
interface Settings {
  data: { user: Profile | null; saving: boolean; avatarEditing: boolean; editing: boolean; selectedAvatar: string; avatarError: string }
  onShow(): void; onHide(): void; onEditAvatar(): void; onAvatarCancel(): void; onEditProfile(): void
  onAvatarSelect(e: ReturnType<typeof select>): void; onAvatarSave(): Promise<void>
}
function settings() {
  const r = messagingRuntime()
  const session = r.load<{ set(value: unknown): void; get(): Profile; clear(): void }>('apps/miniprogram/services/session.ts')
  session.set(profile)
  r.load('apps/miniprogram/pages/settings/settings.ts')
  const page = r.page<Settings>(); page.onShow()
  return { ...r, session, page }
}

test('guest can choose a preset without changing anonymity; save confirmation owns the displayed profile', async () => {
  const r = settings(); r.storage.set('anonymous_mode', true)
  let finish: ((value: { result: { data: unknown } }) => void) | undefined, writes = 0
  r.wx.cloud.callFunction = async ({ data }) => {
    assert.equal(data.action, 'updateProfile'); assert.equal(data.avatar_url, avatars.PRESET_AVATARS[2].src)
    writes++; return new Promise(resolve => { finish = resolve })
  }
  r.page.onEditAvatar(); r.page.onAvatarSelect(select(avatars.PRESET_AVATARS[2].src))
  assert.equal(r.page.data.user?.avatar_url, avatars.DEFAULT_AVATAR)
  const pending = r.page.onAvatarSave()
  await r.page.onAvatarSave(); r.page.onEditProfile(); r.page.onAvatarCancel()
  assert.equal(writes, 1); assert.equal(r.page.data.editing, false); assert.equal(r.page.data.avatarEditing, true)
  finish!({ result: { data: { user: { ...profile, avatar_url: avatars.PRESET_AVATARS[2].src } } } })
  await pending
  assert.equal(r.page.data.user?.avatar_url, avatars.PRESET_AVATARS[2].src)
  assert.equal(r.page.data.avatarEditing, false); assert.equal(r.page.data.saving, false)
  assert.equal(r.session.get().avatar_url, avatars.PRESET_AVATARS[2].src)
  assert.equal(r.storage.get('anonymous_mode'), true)
  r.page.onHide(); r.page.onShow()
  assert.equal(r.page.data.user?.avatar_url, avatars.PRESET_AVATARS[2].src)
  r.page.onHide()
})

test('failed avatar save retains selection; cancellation and anonymous selections never write', async () => {
  const r = settings(); let writes = 0
  r.wx.cloud.callFunction = async () => { writes++; throw Error('offline') }
  r.page.onEditAvatar(); r.page.onAvatarSelect(select(avatars.ANONYMOUS_AVATAR))
  assert.equal(r.page.data.selectedAvatar, avatars.DEFAULT_AVATAR)
  await r.page.onAvatarSave(); assert.equal(writes, 0)
  r.page.onAvatarSelect(select(avatars.PRESET_AVATARS[1].src)); await r.page.onAvatarSave()
  assert.equal(r.page.data.selectedAvatar, avatars.PRESET_AVATARS[1].src)
  assert.ok(r.page.data.avatarError); assert.equal(r.page.data.saving, false)
  assert.equal(r.session.get().avatar_url, avatars.DEFAULT_AVATAR)
  r.page.onAvatarCancel(); assert.equal(r.page.data.avatarEditing, false)
  assert.equal(writes, 1); r.page.onHide()
})

test('old avatar save cannot restore another account or reopen a hidden editor', async () => {
  const r = settings()
  let finish: ((value: { result: { data: unknown } }) => void) | undefined
  r.wx.cloud.callFunction = async () => new Promise(resolve => { finish = resolve })
  r.page.onEditAvatar(); r.page.onAvatarSelect(select(avatars.PRESET_AVATARS[3].src))
  const pending = r.page.onAvatarSave()
  r.page.onHide(); r.session.set({ ...profile, _openid: 'bob' }); r.page.onShow()
  finish!({ result: { data: { user: { ...profile, avatar_url: avatars.PRESET_AVATARS[3].src } } } })
  await pending
  assert.equal(r.session.get()._openid, 'bob'); assert.equal(r.page.data.user?._openid, 'bob')
  assert.equal(r.page.data.avatarEditing, false); assert.equal(r.page.data.avatarError, '')
  assert.equal(r.page.data.saving, false); r.page.onHide()
})

test('anonymous rendering overrides every source and remote legacy images are never fetched', () => {
  for (const src of [...avatars.PRESET_AVATARS.map(item => item.src), '', '/assets/anonymous.png', 'https://external.test/secret.png']) {
    assert.equal(avatars.resolveAvatarSource(src, true), avatars.ANONYMOUS_AVATAR)
  }
  assert.equal(avatars.resolveAvatarSource('https://external.test/secret.png'), avatars.DEFAULT_AVATAR)
  const display = parseConversationDisplay({ selfVisibility: 'real', peerVisibility: 'anonymous', peerName: '匿名会话',
    peerAvatar: 'https://external.test/secret.png', blockedHere: false })
  assert.equal(display.peerAvatar, avatars.ANONYMOUS_AVATAR)
})

interface AvatarComponent {
  properties: { src: string; anonymous: boolean }
  data: { displaySrc: string; generation: number; frames: { src: string; generation: number }[] }
  setData(value: object): void; showSource(src: string): void
  onError(e: { currentTarget: { dataset: { generation: number } } }): void
}
interface Definition { data: AvatarComponent['data']; methods: Pick<AvatarComponent, 'showSource' | 'onError'>
  observers: { 'src, anonymous': (this: AvatarComponent, src: string, anonymous: boolean) => void } }

test('avatar component ignores obsolete failures and terminates anonymous and default fallback failures', () => {
  let definition!: Definition
  const source = readFileSync('apps/miniprogram/components/avatar/avatar.ts', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports: {}, require: () => avatars, Component: (value: Definition) => { definition = value } })
  const component: AvatarComponent = { ...definition.methods, properties: { src: avatars.PRESET_AVATARS[3].src, anonymous: false },
    data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value) } }
  const update = (src: string, anonymous: boolean) => {
    component.properties = { src, anonymous }; definition.observers['src, anonymous'].call(component, src, anonymous)
  }
  const fail = (generation = component.data.generation) => component.onError({ currentTarget: { dataset: { generation } } })
  update(avatars.PRESET_AVATARS[3].src, false)
  const stale = component.data.generation
  update(avatars.PRESET_AVATARS[3].src, true); fail(stale)
  assert.equal(component.data.displaySrc, avatars.ANONYMOUS_AVATAR)
  fail(); assert.equal(component.data.frames.length, 0)
  const terminal = component.data.generation; fail(terminal - 1)
  assert.equal(component.data.generation, terminal)
  update(avatars.PRESET_AVATARS[2].src, false); fail()
  assert.equal(component.data.displaySrc, avatars.DEFAULT_AVATAR)
  fail(); assert.equal(component.data.frames.length, 0)
  update(avatars.PRESET_AVATARS[1].src, false)
  assert.equal(component.data.displaySrc, avatars.PRESET_AVATARS[1].src)
})
