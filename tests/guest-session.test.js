const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function runtime() {
  const storage = new Map()
  const calls = []
  const timers = new Map()
  let nextTimer = 0
  const app = { globalData: { user: null, openid: null } }
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    cloud: { init() {}, callFunction: async args => { calls.push(args); return { result: { data: {} } } } },
    getNetworkType: async () => ({ networkType: 'wifi' }),
    onNetworkStatusChange() {},
  }
  for (const name of ['navigateBack', 'navigateTo', 'switchTab', 'reLaunch', 'showModal', 'removeTabBarBadge', 'setTabBarBadge', 'setTabBarStyle']) {
    wx[name] = args => calls.push({ name, ...args })
  }
  const env = {
    wx, console, getApp: () => app, getCurrentPages: () => [{}, {}],
    setInterval: fn => { timers.set(++nextTimer, fn); return nextTimer },
    clearInterval: id => timers.delete(id),
    setTimeout, clearTimeout,
    Page: page => { env.page = page; page.setData = data => Object.assign(page.data, data) },
    App: value => { Object.assign(app, value) },
  }
  const modules = new Map()
  function load(relative) {
    const filename = path.resolve(root, relative)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const source = fs.readFileSync(filename, 'utf8')
    const code = filename.endsWith('.ts')
      ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
      : source
    vm.runInNewContext(code, {
      ...env, module, exports: module.exports,
      require: spec => {
        if (!spec.startsWith('.')) return require(spec)
        const resolved = path.resolve(path.dirname(filename), spec)
        if (fs.existsSync(resolved + '.ts')) return load(resolved + '.ts')
        if (fs.existsSync(path.join(resolved, 'index.ts'))) return load(path.join(resolved, 'index.ts'))
        return load(resolved + '.js')
      },
    }, { filename })
    return module.exports
  }
  return { load, env, wx, app, calls, storage, timers }
}
const profile = { profile_version: 0, _openid: 'alice', verified: false, nickname: 'Alice', avatar_url: '', role: 'user', email: '' }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('launch and login page share automatic WeChat identity and preserve existing verification', async () => {
  for (const verified of [false, true]) {
    const r = runtime()
    let complete, ensures = 0
    r.wx.cloud.callFunction = ({ data }) => {
      if (data.action !== 'ensure') return Promise.resolve({ result: { data: { count: 0 } } })
      ensures++
      return new Promise(resolve => { complete = resolve })
    }
    r.load('apps/miniprogram/app.ts')
    r.app.onLaunch()
    r.load('apps/miniprogram/pages/login/login.ts')
    r.env.page.onLoad({})
    assert.equal(ensures, 1)
    complete({ result: { data: { user: { ...profile, nickname: 'hvydw1', verified } } } })
    await tick()
    const session = r.load('apps/miniprogram/services/session.ts')
    assert.equal(session.getState(), verified ? 'verified' : 'unverified')
    assert.equal(session.get().nickname, 'hvydw1')
    assert.equal(session.getOpenid(), 'alice')
    assert.equal(r.calls.at(-1).url, '/pages/index/index')
    assert.equal(r.app.globalData.launchReady, true)
  }
})

test('automatic identity returns to the originating page without verification redirect', async () => {
  const r = runtime()
  r.wx.cloud.callFunction = async () => ({ result: { data: { user: profile } } })
  r.load('apps/miniprogram/pages/login/login.ts')
  r.env.page.onLoad({ intent: 'login' })
  await tick()
  assert.equal(r.load('apps/miniprogram/services/session.ts').getState(), 'unverified')
  assert.equal(r.calls.at(-1).name, 'navigateBack')
  assert.equal(r.calls.some(x => x.url?.includes('email-verify')), false)
})

test('hidden login cannot navigate and cleared sessions reject delayed automatic identity', async () => {
  const r = runtime()
  let complete
  r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
  r.load('apps/miniprogram/pages/login/login.ts')
  const pending = r.env.page.handleLogin()
  r.env.page.onHide()
  r.load('apps/miniprogram/services/session.ts').clear()
  complete({ result: { data: { user: profile } } })
  await pending
  assert.equal(r.load('apps/miniprogram/services/session.ts').get(), null)
  assert.equal(r.calls.some(x => x.name === 'switchTab'), false)
})

test('failed identity allows public browsing and can be retried without a persistent guest choice', async () => {
  const r = runtime()
  r.wx.cloud.callFunction = async () => { throw new Error('offline') }
  r.load('apps/miniprogram/pages/login/login.ts')
  await r.env.page.handleLogin()
  assert.match(r.env.page.data.error, /公开内容/)
  assert.equal(r.env.page.data.loading, false)
  r.env.page.handleBrowse()
  assert.equal(r.calls.at(-1).url, '/pages/index/index')
  assert.equal(r.storage.has('guest_browsing'), false)
  r.wx.cloud.callFunction = async () => ({ result: { data: { user: profile } } })
  await r.load('apps/miniprogram/services/auth.ts').ensureLogin()
  assert.equal(r.load('apps/miniprogram/services/session.ts').getState(), 'unverified')
})

test('automatic identity rejects malformed permissions instead of promoting an account', async () => {
  const r = runtime()
  const auth = r.load('apps/miniprogram/services/auth.ts')
  for (const user of [{ ...profile, verified: 'false' }, { ...profile, role: 'owner' }, { ...profile, _openid: '' }]) {
    r.wx.cloud.callFunction = async () => ({ result: { data: { user } } })
    await assert.rejects(auth.ensureLogin(), error => error.code === 'INVALID_RESPONSE')
    assert.equal(r.load('apps/miniprogram/services/session.ts').get(), null)
  }
})

test('automatic ensure preserves existing account fields without writes or trusting caller identity', async () => {
  const existing = { ...profile, _id: 'existing-account', nickname: 'hvydw1', verified: true, role: 'admin',
    email: 'fixture@nottingham.edu.cn', verified_at: '2026-01-01T00:00:00.000Z' }
  let lookups = 0
  const db = { command: {}, collection: () => { throw Error('Existing account must not be rewritten') } }
  const main = cloudHandler('users', db, {}, {
    authorizeAction: async () => ({ allowed: true }),
    findUserByOpenid: async (_, openid) => { lookups++; assert.equal(openid, 'alice'); return existing },
  })
  const result = await main({ action: 'ensure', openid: 'bob', verified: false, role: 'user' })
  assert.equal(lookups, 1)
  assert.equal(result.data.user._openid, existing._openid)
  assert.equal('_id' in result.data.user, false)
  assert.equal(result.data.user.verified, true)
  assert.equal(result.data.user.role, 'admin')
  assert.equal(result.data.user.email, existing.email)
  assert.equal(result.data.user.nickname, 'hvydw1')
})

test('account cloud initialization converges concurrent requests and propagates lookup or transaction faults', async () => {
  const rows = new Map()
  let writes = 0, failLookup = false, failRead = false, tail = Promise.resolve()
  const db = { command: {},
    collection: () => ({ where: () => ({ limit: () => ({ get: async () => {
      if (failLookup) throw Error('lookup offline')
      return { data: [] }
    } }) }) }),
    runTransaction(callback) {
      const promise = tail.then(async () => {
        const staged = new Map(rows)
        const result = await callback({ collection: () => ({ doc: id => ({
          get: async () => { if (failRead) throw Error('transaction offline'); return { data: staged.get(id) || null } },
          set: async ({ data }) => { writes++; staged.set(id, { ...data, _id: id }) },
        }) }) })
        rows.clear(); for (const [id, value] of staged) rows.set(id, value)
        return result
      })
      tail = promise.catch(() => {})
      return promise
    },
  }
  const main = cloudHandler('users', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const results = await Promise.all([main({ action: 'ensure' }), main({ action: 'ensure' })])
  assert.equal(results.every(result => result.data.user._openid === 'alice' && !result.data.user.verified), true)
  assert.equal(rows.size, 1)
  assert.equal(writes, 1)
  failLookup = true
  assert.equal((await main({ action: 'ensure' })).code, 'QUERY_ERROR')
  failLookup = false; failRead = true
  assert.equal((await main({ action: 'ensure' })).code, 'QUERY_ERROR')
  assert.equal(writes, 1)
  assert.equal((await main({ action: 'ensure', nickname: 'silent overwrite' })).code, 'INVALID_INPUT')
})

test('profile observes automatic identity only while visible', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  r.load('apps/miniprogram/pages/profile/profile.ts')
  const page = r.env.page
  page.onShow()
  assert.equal(page.data.user, null)
  session.set(profile)
  assert.equal(page.data.user._openid, 'alice')
  session.clear()
  assert.equal(page.data.user, null)
  page.onHide()
  session.set({ ...profile, _openid: 'bob' })
  assert.equal(page.data.user, null)
  page.onShow()
  assert.equal(page.data.user._openid, 'bob')
  page.onUnload()
})

test('session validates cached identity once and damaged storage cannot revive a session', () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  r.storage.set('user_profile', { ...profile, verified: 'true' })
  r.wx.removeStorageSync = () => { throw Error('disk unavailable') }
  assert.equal(session.get(), null)
  r.storage.set('user_profile', { ...profile, verified: true })
  assert.equal(session.get(), null)
  session.set(profile)
  assert.equal(session.getState(), 'unverified')
  const revision = session.getRevision()
  assert.throws(() => session.set({ ...profile, role: 'root' }))
  assert.equal(session.getRevision(), revision)
  assert.equal(session.getState(), 'unverified')
})

test('valid cache restores only account DTO fields and private mutation rejects another account', async () => {
  const r = runtime()
  r.storage.set('user_profile', { ...profile, verified: true, internal_record: 'never expose' })
  const session = r.load('apps/miniprogram/services/session.ts')
  assert.equal(session.get().internal_record, undefined)
  assert.equal(r.app.globalData.openid, 'alice')
  const revision = session.getRevision()
  r.wx.cloud.callFunction = async () => ({ result: { data: { user: { ...profile, _openid: 'bob' } } } })
  await assert.rejects(r.load('apps/miniprogram/services/users.ts').updateProfile({ nickname: 'Alice' }), error => error.code === 'INVALID_RESPONSE')
  assert.equal(session.getOpenid(), 'alice')
  assert.equal(session.getRevision(), revision)
})

test('author page distinguishes missing profile and failed post count and drops hidden results', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set(profile)
  r.load('apps/miniprogram/pages/user/user.ts')
  const page = r.env.page
  r.wx.cloud.callFunction = async () => ({ result: { data: { profile: null } } })
  await page.loadProfile('bob')
  assert.equal(page.data.state, 'empty')
  assert.equal(page.data.profile, null)
  r.wx.cloud.callFunction = async () => { throw Error('offline') }
  await page.loadPosts(true, 'bob')
  assert.equal(page.data.postCount, null)
  assert.equal(page.data.postState, 'error')
  let complete
  r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
  const pending = page.loadProfile('bob')
  page.onHide()
  let writes = 0
  page.setData = () => { writes++ }
  complete({ result: { data: { profile: { _openid: 'bob', nickname: 'Bob', avatar_url: '' } } } })
  await pending
  assert.equal(writes, 0)
})

test('guest public reads request a public view and private reads never reach the cloud', async () => {
  const r = runtime()
  const { callCloud } = r.load('apps/miniprogram/services/cloud.ts')
  for (const [name, action] of [['posts', 'list'], ['posts', 'search'], ['posts', 'get'], ['comments', 'list']]) {
    await callCloud(name, { action })
    assert.equal(r.calls.at(-1).data.public_only, true)
  }
  const count = r.calls.length
  for (const name of ['messages', 'drafts']) await assert.rejects(callCloud(name, { action: 'list' }))
  assert.equal(r.calls.length, count)
})

test('cloud caller rejects malformed successful responses before they reach pages', async () => {
  const r = runtime()
  r.wx.cloud.callFunction = async () => ({ result: { unexpected: true } })
  const { callCloud, CloudCallError } = r.load('apps/miniprogram/services/cloud.ts')
  await assert.rejects(
    callCloud('posts', { action: 'list' }),
    error => error instanceof CloudCallError && error.code === 'INVALID_RESPONSE',
  )
})

test('cloud transport errors never display SDK internals or secret-bearing payloads', async () => {
  const r = runtime()
  r.wx.cloud.callFunction = async () => { throw { errCode: 777, errMsg: 'Authorization secret-token account@example.edu' } }
  const { callCloud } = r.load('apps/miniprogram/services/cloud.ts')
  await assert.rejects(callCloud('posts', { action: 'list' }), error => {
    assert.equal(error.message.includes('secret-token'), false)
    assert.equal(error.message.includes('account@'), false)
    assert.equal(error.code, '777')
    return true
  })
})

test('guards distinguish guest, unverified and verified sessions without redirecting to email', () => {
  const r = runtime()
  r.load('apps/miniprogram/config.ts').default.EMAIL_VERIFICATION_ENABLED = false
  const session = r.load('apps/miniprogram/services/session.ts')
  const guard = r.load('apps/miniprogram/utils/guard.ts')
  assert.equal(guard.requireVerified(), false)
  assert.equal(r.calls.at(-1).confirmText, '微信登录')
  session.set(profile)
  assert.equal(guard.requireVerified(), false)
  assert.match(r.calls.at(-1).title, /暂不可用/)
  session.set({ ...profile, verified: true })
  assert.equal(guard.requireVerified(), true)
})

test('logout stops badge polling, clears identity and discards late badge responses', async () => {
  const r = runtime()
  const pending = []
  r.wx.cloud.callFunction = args => new Promise(resolve => pending.push({ args, resolve }))
  r.load('apps/miniprogram/app.ts')
  r.app.onLaunch()
  r.app.onShow()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  assert.equal(r.timers.size, 1)
  session.logout()
  assert.equal(r.timers.size, 0)
  assert.equal(r.app.globalData.openid, null)
  assert.equal(session.get(), null)
  assert.equal(r.calls.at(-1).name, 'reLaunch')
  for (const request of pending) request.resolve({ result: { data: request.args.data.action === 'listConversations' ? { conversations: [] } : { count: 5 } } })
  await tick()
  assert.equal(r.calls.some(x => x.name === 'setTabBarBadge'), false)
})

test('logout survives storage and listener failures without restoring cached identity', () => {
  const r = runtime()
  r.load('apps/miniprogram/app.ts')
  r.app.onLaunch()
  r.app.onShow()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  assert.equal(r.timers.size, 1)
  const attemptedKeys = []
  r.wx.removeStorageSync = key => { attemptedKeys.push(key); throw new Error('disk unavailable') }
  session.onChange(() => { throw new Error('broken subscriber') })
  let notified = false
  session.onChange(() => { notified = true })
  session.logout()
  assert.equal(r.storage.get('user_profile')._openid, 'alice')
  assert.equal(session.get(), null)
  assert.equal(session.getState(), 'guest')
  assert.equal(r.app.globalData.openid, null)
  assert.equal(r.timers.size, 0)
  assert.equal(notified, true)
  assert.deepEqual(attemptedKeys, ['user_profile', 'guest_browsing', 'anonymous_mode'])
  assert.equal(r.calls.at(-1).name, 'reLaunch')
})

test('late identity mutations cannot restore logged-out or replaced sessions', async () => {
  for (const operation of ['profile', 'verification', 'login']) {
    for (const replacement of [null, { ...profile, _openid: 'bob' }]) {
      const r = runtime()
      const session = r.load('apps/miniprogram/services/session.ts')
      session.set(profile)
      let complete
      r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
      const users = r.load('apps/miniprogram/services/users.ts')
      const pending = operation === 'profile' ? users.updateProfile({ nickname: 'New' })
        : operation === 'verification' ? users.verifyEmailCode('a@nottingham.edu.cn', '123456')
        : r.load('apps/miniprogram/services/auth.ts').ensureLogin()
      const rejected = assert.rejects(pending, /会话已变更/)
      session.clear()
      if (replacement) session.set(replacement)
      complete({ result: { data: { user: { ...profile, _id: 'account-alice', verified: true } } } })
      await rejected
      assert.equal(session.getOpenid(), replacement?._openid || null)
    }
  }
})

test('settings ignores profile results after hiding or unloading and writes session only once', async () => {
  for (const lifecycle of [null, 'onHide', 'onUnload']) {
    const r = runtime()
    const session = r.load('apps/miniprogram/services/session.ts')
    session.set(profile)
    let changes = 0
    session.onChange(() => { changes += 1 })
    r.wx.showToast = args => r.calls.push({ name: 'showToast', ...args })
    r.load('apps/miniprogram/pages/settings/settings.ts')
    const page = r.env.page
    page.onShow()
    page.setData({ editValue: 'New name', editing: true })
    let complete
    r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
    const pending = page.onEditSave()
    if (lifecycle) page[lifecycle]()
    complete({ result: { data: { user: { ...profile, nickname: 'New name' } } } })
    await pending
    assert.equal(changes, 1)
    assert.equal(session.get().nickname, 'New name')
    assert.equal(r.calls.filter(call => call.name === 'showToast').length, lifecycle ? 0 : 1)
    if (lifecycle === 'onHide') {
      page.onShow()
      assert.equal(page.data.saving, false)
      assert.equal(page.data.user.nickname, 'New name')
    }
  }
})

test('email page discards late send and verify results after view disposal', async () => {
  for (const operation of ['send', 'verify']) {
    const r = runtime()
    r.load('apps/miniprogram/config.ts').default.EMAIL_VERIFICATION_ENABLED = true
    r.load('apps/miniprogram/services/session.ts').set(profile)
    r.wx.showToast = args => r.calls.push({ name: 'showToast', ...args })
    let complete
    r.wx.cloud.callFunction = args => args.data.action === 'ensure'
      ? Promise.resolve({ result: { data: { user: profile } } })
      : new Promise(resolve => { complete = resolve })
    r.load('apps/miniprogram/pages/email-verify/email-verify.ts')
    const page = r.env.page
    page.onShow()
    page.setData({ email: 'alice@nottingham.edu.cn', code: '123456' })
    const pending = operation === 'send' ? page.onSendCode() : page.onVerify()
    await tick()
    assert.equal(typeof complete, 'function')
    page.onUnload()
    page.setData = () => { throw new Error('disposed page rendered') }
    complete({ result: { data: operation === 'send' ? { expiresIn: 600 }
      : { user: { ...profile, _id: 'account-alice', verified: true } } } })
    await pending
    assert.equal(r.timers.size, 0)
    assert.equal(page.redirectTimer, null)
    assert.equal(r.calls.length, 0)
  }
})

test('email cooldown timers stop while hidden and resume from the deadline', () => {
  const r = runtime()
  r.load('apps/miniprogram/pages/email-verify/email-verify.ts')
  const page = r.env.page
  page.startCooldown(60)
  assert.equal(r.timers.size, 1)
  page.onHide()
  assert.equal(r.timers.size, 0)
  page.onShow()
  assert.equal(r.timers.size, 1)
  assert.ok(page.data.cooldown <= 60 && page.data.cooldown > 0)
  page.onUnload()
  assert.equal(r.timers.size, 0)
})

test('message badge uses total counts rather than the conversation page', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const actions = []
  r.wx.cloud.callFunction = async ({ data }) => {
    actions.push(data.action)
    assert.ok(['getUnreadMessageCount', 'getUnreadNotificationCount'].includes(data.action))
    return { result: { data: { count: data.action === 'getUnreadMessageCount' ? 240 : 3 } } }
  }
  const badge = r.load('apps/miniprogram/services/badge.ts')
  assert.equal(await badge.refreshMessageBadge(), 243)
  assert.equal(actions.length, 2)
  assert.equal(r.calls.at(-1).text, '99+')
})

test('unread message count is scoped to recipient and excludes read messages', async () => {
  let condition
  const db = { command: { neq: value => ({ not: value }) }, collection(name) {
    assert.equal(name, 'messages')
    return { where(value) { condition = value; return { count: async () => ({ total: 240 }) } } }
  } }
  const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const result = await main({ action: 'getUnreadMessageCount', to: 'mallory' })
  assert.equal(result.data.count, 240)
  assert.equal(condition.to, 'alice')
  assert.equal(condition.status.not, 'read')
})

test('old email links display a paused state and cannot send or verify codes', async () => {
  const r = runtime()
  r.load('apps/miniprogram/config.ts').default.EMAIL_VERIFICATION_ENABLED = false
  r.load('apps/miniprogram/pages/email-verify/email-verify.ts')
  r.env.page.onLoad()
  await r.env.page.onSendCode()
  await r.env.page.onVerify()
  assert.equal(r.env.page.data.verificationEnabled, false)
  assert.equal(r.calls.length, 0)
})

test('guest message and profile tabs show guidance without private requests', async () => {
  const r = runtime()
  r.load('apps/miniprogram/pages/messages/messages.ts')
  r.env.page.onShow()
  assert.equal(r.env.page.data.access, 'guest')
  assert.equal(r.env.page.data.conversations.length, 0)
  r.load('apps/miniprogram/pages/profile/profile.ts')
  r.env.page.onShow()
  await tick()
  assert.equal(r.env.page.data.user, null)
  assert.equal(r.calls.some(x => x.data || x.name === 'navigateTo'), false)
})

test('logout stops active chat polling and discards a pending private response', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  let finish
  r.wx.cloud.callFunction = () => new Promise(resolve => { finish = resolve })
  const watch = r.load('apps/miniprogram/services/watch.ts')
  const updates = []
  watch.pollMessages('bob', { version: 2, conversation_id: 'conversation-1', sequence: 0 }, messages => updates.push(messages), () => {})
  const poll = [...r.timers.values()][0]()
  session.logout()
  assert.equal(r.timers.size, 0)
  finish({ result: { data: { messages: [{ _id: 'secret' }], hasMore: false } } })
  await poll
  assert.equal(updates.length, 0)
})

function cloudHandler(name, db, env = {}, overrides = {}) {
  const module = { exports: {} }
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'alice' }),
    openapi: { security: { msgSecCheck: async () => ({ errcode: 0, result: { suggest: 'pass' } }) } } }
  const filename = path.join(root, 'apps', 'cloudfunctions', name, 'index.ts')
  const source = require('typescript').transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText
  vm.runInNewContext(source, {
    module, exports: module.exports, console, process: { env },
    require: spec => spec === 'wx-server-sdk' ? cloud : spec === '../common'
      ? { ...require('../apps/cloudfunctions/common'), ...overrides }
      : require(spec.startsWith('.') ? path.resolve(path.dirname(filename), spec) : spec),
  })
  return module.exports.main
}

test('server rejects both email actions while paused before database or mail access', async () => {
  const main = cloudHandler('users', { command: {}, collection() { throw new Error('unexpected database access') } })
  for (const action of ['sendEmailCode', 'verifyEmailCode']) {
    const result = await main({ action })
    assert.equal(result.code, 'EMAIL_VERIFICATION_UNAVAILABLE')
  }
})

test('guest public view cannot retrieve an owned flagged post', async () => {
  const db = { command: {}, collection: () => ({ doc: () => ({ get: async () => ({ data: { _id: 'p', _openid: 'alice', status: 'flagged' } }) }) }) }
  let adminChecks = 0
  const main = cloudHandler('posts', db, {}, { checkAdmin: async () => { adminChecks += 1; return false } })
  assert.equal((await main({ action: 'get', post_id: 'p', public_only: true })).code, 'NOT_FOUND')
  assert.equal(adminChecks, 0)
})

test('guest can read a published anonymous post without owner identity or privileges', async () => {
  const post = { request_fingerprint: 'secret-fingerprint', last_update_fingerprint: 'secret-update', request_id: 'secret-request', _id: 'p', _openid: 'alice', status: 'published', anonymous: true,
    title: 'Hello', category_id: '', category: null, revision: 1, view_count: 0, comment_count: 0, created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z', content: 'hello campus', author: { _openid: 'alice', nickname: 'Alice' } }
  const db = { command: {}, collection: () => ({ doc: () => ({ get: async () => ({ data: post }) }) }) }
  let adminChecks = 0
  const main = cloudHandler('posts', db, {}, { checkAdmin: async () => { adminChecks += 1; return false } })
  const result = await main({ action: 'get', post_id: 'p', public_only: true, skip_view_inc: true })
  assert.equal(result.data.post.content, 'hello campus')
  assert.equal(result.data.post.is_mine, false)
  assert.equal(result.data.post._openid, undefined)
  assert.equal(result.data.post.author._openid, undefined)
  assert.equal(adminChecks, 0)
  assert.equal('last_update_fingerprint' in result.data.post, false)
  assert.equal('request_fingerprint' in result.data.post, false)
  assert.equal('request_id' in result.data.post, false)
})

test('unverified writes remain blocked at the server boundary', async () => {
  const db = { command: {}, collection() { throw new Error('write reached database') } }
  const authorization = async () => ({
    allowed: false,
    response: { error: '请先完成 Nottingham 邮箱认证', code: 'EMAIL_NOT_VERIFIED' },
  })
  for (const [name, action] of [['posts', 'create'], ['comments', 'create'], ['messages', 'send']]) {
    const main = cloudHandler(name, db, {}, { authorizeAction: authorization })
    assert.equal((await main({ action })).code, 'EMAIL_NOT_VERIFIED')
  }
})

test('private message and draft reads are rejected before touching the database', async () => {
  const db = { command: {}, collection() { throw new Error('private read reached database') } }
  const authorization = async () => ({
    allowed: false,
    response: { error: '请先完成 Nottingham 邮箱认证', code: 'EMAIL_NOT_VERIFIED' },
  })
  const messages = cloudHandler('messages', db, {}, { authorizeAction: authorization })
  const drafts = cloudHandler('drafts', db, {}, { authorizeAction: authorization })
  for (const [handler, action] of [[messages, 'listConversations'], [messages, 'listNotifications'], [drafts, 'list'], [drafts, 'delete']]) {
    assert.equal((await handler({ action, draft_id: 'draft-1' })).code, 'EMAIL_NOT_VERIFIED')
  }
})

test('idempotent content deletion still verifies ownership before returning success', async () => {
  const deletedPost = { _id: 'post-1', _openid: 'bob', status: 'deleted' }
  const deletedComment = { _id: 'comment-1', _openid: 'bob', status: 'deleted' }
  const postDb = { command: {}, collection: () => ({ doc: () => ({ get: async () => ({ data: deletedPost }) }) }) }
  const commentDb = { command: {}, collection: () => ({ doc: () => ({ get: async () => ({ data: deletedComment }) }) }) }
  commentDb.runTransaction = work => work(commentDb)
  const allowed = async () => ({ allowed: true })
  const posts = cloudHandler('posts', postDb, {}, { checkAdmin: async () => false, authorizeAction: allowed })
  const comments = cloudHandler('comments', commentDb, {}, { checkAdmin: async () => false, authorizeAction: allowed })
  assert.equal((await posts({ action: 'delete', post_id: 'post-1' })).code, 'FORBIDDEN')
  assert.equal((await comments({ action: 'delete', comment_id: 'comment-1' })).code, 'FORBIDDEN')
})

test('sequence message sync paginates same-time messages without a gap', async () => {
  const messages = [1, 2, 3].map(sequence => ({
    _id: `message-${sequence}`,
    msg_id: `request-${sequence}`,
    status: 'sent',
    from: 'alice',
    to: 'bob-user',
    content: `message ${sequence}`,
    created_at: '2026-09-21T00:00:00.000Z',
    conversation_id: require('crypto').createHash('sha256')
      .update(['conversation', 'direct', 'alice', 'bob-user'].join('\0')).digest('hex'),
    sync_sequence: sequence,
  }))
  const command = { gt: value => ({ gt: value }) }
  const db = {
    command,
    collection(name) {
      assert.equal(name, 'messages')
      return {
        where(condition) {
          return {
            orderBy(field, direction) {
              assert.equal(field, 'sync_sequence')
              assert.equal(direction, 'asc')
              return {
                limit(limit) {
                  return {
                    get: async () => ({ data: messages
                      .filter(message => message.conversation_id === condition.conversation_id
                        && message.sync_sequence > condition.sync_sequence.gt)
                      .slice(0, limit) }),
                  }
                },
              }
            },
          }
        },
      }
    },
  }
  const allowed = async () => ({ allowed: true })
  const main = cloudHandler('messages', db, {}, { authorizeAction: allowed })
  const conversationId = messages[0].conversation_id
  const first = await main({
    action: 'syncConversation', peer: 'bob-user', limit: 2,
    cursor: { version: 2, conversation_id: conversationId, sequence: 0 },
  })
  assert.deepEqual(first.data.messages.map(message => message._id), ['message-1', 'message-2'])
  assert.equal(first.data.hasMore, true)
  assert.equal(first.data.nextCursor.sequence, 2)
  const second = await main({
    action: 'syncConversation', peer: 'bob-user', limit: 2,
    cursor: first.data.nextCursor,
  })
  assert.deepEqual(second.data.messages.map(message => message._id), ['message-3'])
  assert.equal(second.data.hasMore, false)
  assert.equal(second.data.nextCursor.sequence, 3)
})

test('comment change sync is post-scoped and returns a monotonic cursor', async () => {
  let failRead = false
  const changes = [
    { post_id: 'post-1', sequence: 1, comment_id: 'comment-1', type: 'created' },
    { post_id: 'post-1', sequence: 2, comment_id: 'comment-2', type: 'deleted' },
    { post_id: 'post-1', sequence: 3, comment_id: 'comment-3', type: 'created' },
  ]
  const comments = new Map([
    ['comment-1', { _id: 'comment-1', _openid: 'bob', post_id: 'post-1', status: 'published', content: 'hello', author: { _openid: 'bob', nickname: 'Bob', avatar_url: '' } }],
    ['comment-2', { _id: 'comment-2', _openid: 'bob', post_id: 'post-1', status: 'deleted', content: '', author: { _openid: 'bob', nickname: 'Bob', avatar_url: '' } }],
    ['comment-3', { _id: 'comment-3', _openid: 'secret-author', post_id: 'post-1', status: 'published', anonymous: true, content: 'anonymous', author: { _openid: 'secret-author', nickname: 'Secret', avatar_url: '/private.png' } }],
  ])
  for (const [id, comment] of comments) comments.set(id, {
    parent_id: null, depth: 0, anonymous: false, created_at: new Date('2026-09-21T00:00:00Z'),
    request_fingerprint: 'private-retry', future_identity: { openid: 'private-owner' }, ...comment,
  })
  const command = { gt: value => ({ gt: value }) }
  const db = {
    command,
    collection(name) {
      if (name === 'posts') return { doc: () => ({ get: async () => ({ data: { _id: 'post-1', status: 'published' } }) }) }
      if (name === 'comments') return { doc: id => ({ get: async () => {
        if (failRead) throw new Error('database unavailable')
        return { data: comments.get(id) || null }
      } }) }
      assert.equal(name, 'comment_changes')
      return {
        where(condition) {
          return { orderBy: () => ({ limit: limit => ({ get: async () => ({ data: changes
            .filter(change => change.post_id === condition.post_id && change.sequence > condition.sequence.gt)
            .slice(0, limit) }) }) }) }
        },
      }
    },
  }
  const main = cloudHandler('comments', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const first = await main({ action: 'syncChanges', post_id: 'post-1', limit: 1, cursor: { version: 1, post_id: 'post-1', sequence: 0 } })
  assert.equal(first.data.changes[0].comment_id, 'comment-1')
  assert.equal(first.data.next_cursor.sequence, 1)
  assert.equal(first.data.has_more, true)
  const second = await main({ action: 'syncChanges', post_id: 'post-1', limit: 1, cursor: first.data.next_cursor })
  assert.equal(second.data.changes[0].type, 'deleted')
  assert.equal(second.data.changes[0].comment.content, '')
  assert.equal(second.data.next_cursor.sequence, 2)
  const third = await main({ action: 'syncChanges', post_id: 'post-1', cursor: second.data.next_cursor })
  assert.equal(third.data.changes[0].comment.author.nickname, '匿名用户')
  assert.equal(third.data.changes[0].comment._openid, undefined)
  assert.equal(third.data.changes[0].comment.author._openid, undefined)
  assert.equal(JSON.stringify(third).includes('private-'), false)
  failRead = true
  const failed = await main({ action: 'syncChanges', post_id: 'post-1', cursor: second.data.next_cursor })
  assert.equal(failed.code, 'QUERY_ERROR')
  assert.equal(failed.data, undefined)
  failRead = false
  const retried = await main({ action: 'syncChanges', post_id: 'post-1', cursor: second.data.next_cursor })
  assert.equal(retried.data.next_cursor.sequence, 3)
  comments.delete('comment-3')
  const removed = await main({ action: 'syncChanges', post_id: 'post-1', cursor: second.data.next_cursor })
  assert.equal(removed.data.changes[0].comment, null)
  assert.equal(removed.data.next_cursor.sequence, 3)
  const wrongScope = await main({ action: 'syncChanges', post_id: 'post-1', cursor: { version: 1, post_id: 'post-2', sequence: 0 } })
  assert.equal(wrongScope.code, 'INVALID_INPUT')
})

test('a sequence cursor cannot be replayed for another conversation', async () => {
  const db = { command: {}, collection() { throw new Error('query should not run') } }
  const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const result = await main({
    action: 'syncConversation', peer: 'bob-user',
    cursor: { version: 2, conversation_id: 'another-conversation', sequence: 0 },
  })
  assert.equal(result.code, 'INVALID_INPUT')
  for (const cursor of [undefined, null, false, '', { version: 1, sequence: 0 }]) {
    const rejected = await main({
      action: 'syncConversation', peer: 'bob-user', cursor,
      since: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(rejected.code, 'INVALID_INPUT')
  }
})

test('conversation directory never falls back to scanning historical messages', async () => {
  for (const missing of [false, true]) {
    const accessed = []
    const db = { command: {}, collection(name) {
      accessed.push(name)
      const query = { where() { return this }, orderBy() { return this }, limit() { return this },
        async get() {
          if (missing) throw Object.assign(new Error('collection missing'), { errCode: -502005 })
          return { data: [] }
        } }
      return query
    } }
    const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
    const result = await main({ action: 'listConversations' })
    assert.deepEqual(accessed, ['conversation_entries'])
    if (missing) assert.equal(result.code, 'QUERY_ERROR')
    else {
      assert.equal(result.data.conversations.length, 0)
      assert.equal(result.data.source, 'directory')
    }
  }
})

test('post request IDs are idempotent and reject changed payloads', async () => {
  const posts = new Map()
  const missing = () => Object.assign(new Error('not found'), { errCode: -1 })
  const collection = () => ({
    doc(id) {
      return {
        get: async () => {
          if (!posts.has(id)) return { data: null }
          return { data: posts.get(id) }
        },
        set: async ({ data }) => posts.set(id, { ...data, _id: id }),
        add: async ({ data }) => {
          const id = `generated-${posts.size + 1}`
          posts.set(id, { ...data, _id: id })
          return { _id: id }
        },
      }
    },
  })
  const db = {
    command: {},
    serverDate: () => new Date('2026-09-21T00:00:00.000Z'),
    collection,
    runTransaction: async callback => callback({ collection: name => name === 'users'
      ? { doc: () => ({ get: async () => ({ data: { ...profile, verified: true } }) }) } : collection(name) }),
  }
  const main = cloudHandler('posts', db, {}, {
    authorizeAction: async () => ({ allowed: true, user: { ...profile, _id: 'account-alice', verified: true } }),
    requireVerifiedUser: async () => true,
    checkRateLimit: async () => ({ allowed: true }),
    getAuthorSnapshot: async () => ({ _openid: 'alice', nickname: 'Alice', avatar_url: '' }),
  })
  const first = await main({ action: 'create', anonymous: false, title: 'Hello', content: 'Campus', request_id: 'request-1234' })
  const second = await main({ action: 'create', anonymous: false, title: 'Hello', content: 'Campus', request_id: 'request-1234' })
  const conflict = await main({ action: 'create', anonymous: false, title: 'Changed', content: 'Campus', request_id: 'request-1234' })
  assert.equal(first.data.status, 'created')
  assert.equal(second.data.status, 'duplicate')
  assert.equal(conflict.code, 'CONFLICT')
  assert.equal(posts.size, 1)
})

test('post updates reject a stale revision before overwriting newer content', async () => {
  const posts = new Map([['post-1', {
    _id: 'post-1', _openid: 'alice', status: 'published', revision: 4,
    title: 'old', content: 'old', category_id: '', author: { _openid: 'alice', nickname: 'Alice', avatar_url: '' },
  }]])
  const db = {
    command: {}, serverDate: () => new Date('2026-09-21T00:00:00.000Z'),
    collection: () => ({ doc: id => ({
      get: async () => ({ data: posts.get(id) }),
      update: async ({ data }) => posts.set(id, { ...posts.get(id), ...data, _id: id }),
    }) }),
    runTransaction: async callback => callback({ collection: name => name === 'users'
      ? { doc: () => ({ get: async () => ({ data: { ...profile, verified: true } }) }) } : db.collection('posts') }),
  }
  const main = cloudHandler('posts', db, {}, {
    authorizeAction: async () => ({ allowed: true, user: { ...profile, _id: 'account-alice', verified: true } }), requireVerifiedUser: async () => true,
    checkRateLimit: async () => ({ allowed: true }), getAuthorSnapshot: async () => ({ _openid: 'alice', nickname: 'Alice', avatar_url: '' }),
  })
  const stale = await main({ action: 'update', anonymous: false, post_id: 'post-1', expected_revision: 3, title: 'stale', content: 'stale', category_id: '' })
  assert.equal(stale.code, 'CONFLICT')
  const saved = await main({ action: 'update', anonymous: false, post_id: 'post-1', expected_revision: 4, title: 'fresh', content: 'fresh', category_id: '' })
  assert.equal(saved.data.post.revision, 5)
  assert.equal(posts.get('post-1').title, 'fresh')
  const unavailable = cloudHandler('posts', db, {}, {
    authorizeAction: async () => ({ allowed: true, user: { ...profile, _id: 'account-alice', verified: true } }), requireVerifiedUser: async () => true,
    checkRateLimit: async () => ({ allowed: false, unavailable: true }), getAuthorSnapshot: async () => ({ _openid: 'alice', nickname: 'Alice', avatar_url: '' }),
  })
  const rateFailure = await unavailable({ action: 'update', anonymous: false, post_id: 'post-1', expected_revision: 5, title: 'later', content: 'later', category_id: '' })
  assert.equal(rateFailure.code, 'RATE_LIMIT_UNAVAILABLE')
})

test('comment creation persists and drains one idempotent notification outbox event', async () => {
  const stores = new Map([
    ['users', new Map([['alice-account', { ...profile, _id: 'alice-account', verified: true }]])],
    ['posts', new Map([['post-1', { _id: 'post-1', _openid: 'bob', status: 'published', title: 'A post', comment_count: 0 }]])],
    ['comments', new Map()], ['comment_counters', new Map()], ['comment_changes', new Map()],
    ['notification_outbox', new Map()], ['notifications', new Map()],
  ])
  let generated = 0
  const missing = () => Object.assign(new Error('not found'), { errCode: -1 })
  const collection = name => {
    const store = stores.get(name) || new Map()
    stores.set(name, store)
    const doc = id => ({
      get: async () => {
        return { data: store.get(id) || null }
      },
      set: async ({ data }) => store.set(id, { ...data, _id: id }),
      update: async ({ data }) => {
        if (!store.has(id)) throw missing()
        store.set(id, { ...store.get(id), ...data, _id: id })
      },
    })
    return {
      doc,
      add: async ({ data }) => {
        const id = `${name}-${++generated}`
        store.set(id, { ...data, _id: id })
        return { _id: id }
      },
      limit: () => ({ get: async () => ({ data: [] }) }),
    }
  }
  const db = {
    command: {},
    serverDate: () => new Date('2026-09-21T00:00:00.000Z'),
    collection,
    runTransaction: async callback => callback({ collection }),
  }
  const main = cloudHandler('comments', db, {}, {
    authorizeAction: async () => ({ allowed: true, user: { ...profile, _id: 'alice-account', verified: true } }),
    requireVerifiedUser: async () => true,
    checkRateLimit: async () => ({ allowed: true }),
    getAuthorSnapshot: async () => ({ _openid: 'alice', nickname: 'Alice', avatar_url: '' }),
    outboxCandidates: async () => [...stores.get('notification_outbox').keys()],
  })
  const event = { action: 'create', post_id: 'post-1', content: 'Useful reply', anonymous: false, request_id: 'comment-request-1234' }
  const first = await main(event)
  const second = await main(event)
  assert.equal(first.data.status, 'created')
  assert.equal(second.data.status, 'duplicate')
  assert.equal(stores.get('posts').get('post-1').comment_count, 1)
  assert.equal(stores.get('comment_changes').size, 1)
  assert.equal(stores.get('notification_outbox').size, 1)
  assert.equal(stores.get('notifications').size, 1)
  assert.equal([...stores.get('notification_outbox').values()][0].status, 'delivered')
  const notification = [...stores.get('notifications').values()][0]
  notification.read = true
  const outbox = [...stores.get('notification_outbox').values()][0]
  outbox.status = 'pending'; outbox.next_attempt_at = 0
  await main({ action: 'drainOutbox' })
  assert.equal(stores.get('notifications').size, 1)
  assert.equal([...stores.get('notifications').values()][0].read, true)
})

test('public profile response excludes private account state', async () => {
  const user = {
    _openid: 'bob-user', nickname: 'Bob', avatar_url: '/avatar.png',
    role: 'admin', verified: true, email: 'bob@nottingham.edu.cn', created_at: '2026-01-01T00:00:00.000Z',
  }
  const main = cloudHandler('users', { command: {} }, {}, {
    authorizeAction: async () => ({ allowed: true }),
    findUserByOpenid: async () => user,
  })
  const result = await main({ action: 'getProfile', openid: 'bob-user' })
  assert.equal(JSON.stringify(result.data.profile), JSON.stringify({
    _openid: 'bob-user', nickname: 'Bob', avatar_url: '/avatar.png', created_at: '2026-01-01T00:00:00.000Z',
  }))
})

test('public profile cloud adapter does not turn database failures into absent users', async () => {
  const db = { command: {}, collection: () => ({ where: () => ({ limit: () => ({ get: async () => { throw Error('offline') } }) }) }) }
  const main = cloudHandler('users', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  assert.equal((await main({ action: 'getProfile', openid: 'alice' })).code, 'QUERY_ERROR')
  assert.equal((await main({ action: 'getProfile', openid: { forged: true } })).code, 'INVALID_INPUT')
})

test('profile updates enqueue a retryable projection instead of synchronizing in the identity use case', async () => {
  const users = new Map([['user-1', { ...profile, _id: 'user-1', profile_version: 0 }]])
  const outbox = new Map()
  const projections = []
  const missing = () => Object.assign(new Error('not found'), { errCode: -1 })
  const db = {
    command: { neq: value => ({ neq: value }), and: value => ({ and: value }), or: value => ({ or: value }), exists: value => ({ exists: value }), lt: value => ({ lt: value }) },
    serverDate: () => new Date('2026-09-21T00:00:00.000Z'),
    collection(name) {
      const store = name === 'users' ? users : name === 'profile_outbox' ? outbox : null
      if (store) return {
        doc(id) { return {
          get: async () => { if (!store.has(id)) throw missing(); return { data: store.get(id) } },
          set: async ({ data }) => store.set(id, { ...data, _id: id }),
          update: async ({ data }) => store.set(id, { ...store.get(id), ...data, _id: id }),
        } },
      }
      return { where: condition => ({ update: async ({ data }) => projections.push({ name, condition, data }) }) }
    },
    runTransaction: async callback => callback({ collection: name => db.collection(name) }),
  }
  const main = cloudHandler('users', db, {}, {
    authorizeAction: async () => ({ allowed: true }),
    findUserByOpenid: async () => users.get('user-1'),
  })
  const result = await main({ action: 'updateProfile', nickname: 'Alice New' })
  assert.equal(result.data.user.nickname, 'Alice New')
  assert.equal(users.get('user-1').profile_version, 1)
  assert.equal([...outbox.values()][0].status, 'delivered')
  assert.equal(projections.length, 3)
  assert.equal(projections[0].data['author.profile_version'], 1)
  assert.equal(projections[2].data['actor.nickname'], 'Alice New')
})

test('late profile projection cannot overwrite newer snapshots or anonymous content', async () => {
  const rows = {
    posts: [{ _openid: 'alice', anonymous: false, author: { nickname: 'Initial' } },
      { _openid: 'alice', anonymous: true, author: { nickname: '匿名用户' } },
      { _openid: 'bob', anonymous: false, author: { nickname: 'Bob' } }],
    comments: [{ _openid: 'alice', anonymous: false, author: { nickname: 'Initial', profile_version: 0 } }],
    notifications: [{ anonymous: false, actor: { _openid: 'alice', nickname: 'Initial' } }],
  }
  const command = Object.fromEntries(['and', 'or', 'neq', 'exists', 'lt'].map(op => [op, value => ({ [op]: value })]))
  const field = (row, path) => path.split('.').reduce((value, part) => value?.[part], row)
  function matches(row, query) {
    if (query.and) return query.and.every(part => matches(row, part))
    if (query.or) return query.or.some(part => matches(row, part))
    return Object.entries(query).every(([path, expected]) => {
      const value = field(row, path)
      if (expected && typeof expected === 'object') {
        if ('neq' in expected) return value !== expected.neq
        if ('exists' in expected) return (value !== undefined) === expected.exists
        if ('lt' in expected) return typeof value === 'number' && value < expected.lt
      }
      return value === expected
    })
  }
  let release, lookups = 0
  const barrier = new Promise(resolve => { release = resolve })
  const db = { command, serverDate: () => new Date(), collection(name) {
    if (name === 'profile_outbox') return {
      where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ data: [{ _id: 'event' }] }) }) }) }),
      doc: () => ({ update: async () => {} }),
    }
    return { where: query => ({ update: async ({ data }) => {
      const version = data['author.profile_version'] ?? data['actor.profile_version']
      if (version === 1) await barrier
      for (const row of rows[name]) if (matches(row, query)) {
        for (const [path, value] of Object.entries(data)) { const [prefix, key] = path.split('.'); row[prefix][key] = value }
      }
    } }) }
  } }
  const main = cloudHandler('users', db, {}, {
    authorizeAction: async () => ({ allowed: true }),
    claimOutboxEvent: async () => ({ event: { openid: 'alice' }, attemptCount: 1 }),
    outboxCandidates: async () => ['event'],
    finishOutboxEvent: async () => true,
    findUserByOpenid: async () => { const version = ++lookups; return { ...profile, nickname: `Version ${version}`, profile_version: version } },
  })
  const old = main({ action: 'drainProfileOutbox' })
  await tick()
  await main({ action: 'drainProfileOutbox' })
  release()
  await old
  assert.equal(rows.posts[0].author.nickname, 'Version 2')
  assert.equal(rows.comments[0].author.profile_version, 2)
  assert.equal(rows.notifications[0].actor.nickname, 'Version 2')
  assert.equal(rows.posts[1].author.nickname, '匿名用户')
  assert.equal(rows.posts[1].author.profile_version, undefined)
  assert.equal(rows.posts[2].author.nickname, 'Bob')
})

test('draft counter keeps the 50-draft limit across transactional creates and deletes', async () => {
  const drafts = new Map()
  const counters = new Map()
  let sequence = 0
  const missing = () => Object.assign(new Error('not found'), { errCode: -1 })
  const collection = name => {
    const store = name === 'drafts' ? drafts : counters
    const doc = id => ({
      get: async () => { return { data: store.get(id) || null } },
      set: async ({ data }) => store.set(id, { ...data, _id: id }),
      remove: async () => store.delete(id),
      update: async ({ data }) => store.set(id, { ...store.get(id), ...data, _id: id }),
    })
    return {
      doc,
      add: async ({ data }) => {
        const id = `draft-${++sequence}`
        store.set(id, { ...data, _id: id })
        return { _id: id }
      },
      where: condition => ({ limit: () => ({ get: async () => ({ data: [...drafts.values()].filter(draft => draft._openid === condition._openid) }) }) }),
    }
  }
  const counterId = require('../apps/cloudfunctions/common').stableDocumentId('draft:counter', 'alice')
  counters.set(counterId, { _id: counterId, _openid: 'alice', count: 49 })
  const db = {
    command: {}, serverDate: () => new Date('2026-09-21T00:00:00.000Z'), collection,
    runTransaction: async callback => callback({ collection }),
  }
  const main = cloudHandler('drafts', db, {}, {
    authorizeAction: async () => ({ allowed: true }), checkRateLimit: async () => ({ allowed: true }),
  })
  const created = await main({ action: 'save', request_id: 'create-one', title: 'one', content: '', category_id: '', anonymous: false })
  const rejected = await main({ action: 'save', request_id: 'create-two', title: 'two', content: '', category_id: '', anonymous: false })
  assert.equal(created.data.draft.revision, 1)
  assert.equal(rejected.code, 'DRAFT_LIMIT_REACHED')
  assert.equal(counters.get(counterId).count, 50)
  assert.equal((await main({ action: 'delete', draft_id: created.data.draft._id })).data.deleted, true)
  assert.equal(counters.get(counterId).count, 49)
})

test('draft updates reject a stale revision before replacing another editor’s content', async () => {
  const drafts = new Map([['draft-1', { _id: 'draft-1', _openid: 'alice', title: 'old', content: 'old', revision: 3, category_id: '', anonymous: false, created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z' }]])
  const db = {
    command: {}, serverDate: () => new Date('2026-09-21T00:00:00.000Z'),
    collection: () => ({ doc: id => ({
      get: async () => ({ data: drafts.get(id) }),
      set: async ({ data }) => drafts.set(id, { ...drafts.get(id), ...data, _id: id }),
    }) }),
    runTransaction: async callback => callback({ collection: () => db.collection('drafts') }),
  }
  const main = cloudHandler('drafts', db, {}, {
    authorizeAction: async () => ({ allowed: true }), checkRateLimit: async () => ({ allowed: true }),
  })
  const stale = await main({ action: 'save', draft_id: 'draft-1', expected_revision: 2, title: 'stale', content: '', category_id: '', anonymous: false })
  assert.equal(stale.code, 'DRAFT_CONFLICT')
  const saved = await main({ action: 'save', draft_id: 'draft-1', expected_revision: 3, title: 'fresh', content: '', category_id: '', anonymous: false })
  assert.equal(saved.data.draft.revision, 4)
  assert.equal(drafts.get('draft-1').title, 'fresh')
})

test('conversation directory pages tied timestamps exactly once and rejects foreign cursors', async () => {
  const { stableDocumentId } = require('../apps/cloudfunctions/common')
  const date = new Date('2026-09-21T01:00:00.000Z')
  const rows = Array.from({ length: 53 }, (_, i) => ({
    _id: stableDocumentId('entry', String(i)), owner_openid: 'alice', peer_openid: `peer-${i}`,
    updated_at: date, unread_count: 1,
    last_message: { _id: `m${i}`, from: `peer-${i}`, to: 'alice', content: 'hello', created_at: date },
  })).sort((a, b) => b._id.localeCompare(a._id))
  let queries = 0
  const command = {
    lt: value => ({ less: value }), in: values => ({ values }),
    and: values => ({ all: values }), or: values => ({ some: values }),
  }
  const matches = (row, filter) => {
    if (filter.all) return filter.all.every(f => matches(row, f))
    if (filter.some) return filter.some.some(f => matches(row, f))
    return Object.entries(filter).every(([key, value]) => value && value.less !== undefined
      ? row[key] < value.less : String(row[key]) === String(value))
  }
  const db = { command, collection(name) {
    assert.ok(['users', 'conversation_entries'].includes(name))
    let condition, limit
    const order = []
    return { where(value) { condition = value; return this },
      orderBy(field, direction) { order.push([field, direction]); return this },
      limit(value) { limit = value; return this }, field() { return this },
      async get() {
        queries++
        if (name === 'users') return { data: [] }
        assert.deepEqual(order, [['updated_at', 'desc'], ['_id', 'desc']])
        assert.equal(limit, 21)
        return { data: rows.filter(row => matches(row, condition)).slice(0, limit) }
      },
    }
  } }
  const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const peers = []
  let cursor
  let firstCursor
  do {
    const response = await main({ action: 'listConversations', cursor, limit: 20 })
    assert.equal(response.error, undefined)
    peers.push(...response.data.conversations.map(item => item.peer._openid))
    cursor = response.data.nextCursor
    firstCursor ||= cursor
    assert.equal(response.data.hasMore, !!cursor)
  } while (cursor)
  assert.equal(peers.length, 53)
  assert.equal(new Set(peers).size, 53)
  const before = queries
  for (const invalid of [null, false, {}, { ...firstCursor, scope: 'bob' },
    { ...firstCursor, updatedAt: 'not a date' }, { ...firstCursor, id: '' }]) {
    const response = await main({ action: 'listConversations', cursor: invalid })
    assert.equal(response.code, 'INVALID_INPUT')
  }
  assert.equal(queries, before)
})

test('conversation page appends, retries the same cursor and ignores disposed responses', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  r.load('apps/miniprogram/pages/messages/messages.ts')
  const page = r.env.page
  page.updateTabBadge = () => {}
  const conv = id => ({ peer: { _openid: id, nickname: id, avatar_url: '' }, lastMessage: { _id: id, content: 'hello', created_at: '2026-09-21T01:00:00.000Z' }, unreadCount: 0 })
  const cursor = { version: 1, scope: 'a'.repeat(64), id: 'b'.repeat(64), updatedAt: '2026-09-21T01:00:00.000Z' }
  const requests = []
  let fail = false
  r.wx.cloud.callFunction = async args => {
    requests.push(args.data)
    if (fail) throw new Error('network')
    return { result: { data: args.data.cursor
      ? { conversations: [conv('one'), conv('two')], nextCursor: null, hasMore: false }
      : { conversations: [conv('one')], nextCursor: cursor, hasMore: true } } }
  }
  await page.loadConversations()
  fail = true
  await page.loadConversations(true)
  assert.equal(page.data.chatLoadError, true)
  assert.equal(page.data.chatCursor.id, 'b'.repeat(64))
  fail = false
  await page.loadConversations(true)
  assert.equal(page.data.conversations.length, 2)
  assert.equal(page.data.chatHasMore, false)
  assert.equal(requests[1].cursor.id, requests[2].cursor.id)
  for (const dispose of [() => page.onHide(), () => page.onUnload(), () => session.clear()]) {
    session.set({ ...profile, verified: true })
    let resolve
    r.wx.cloud.callFunction = () => new Promise(done => { resolve = done })
    const pending = page.loadConversations()
    dispose()
    let writes = 0
    const original = page.setData
    page.setData = data => { writes++; original(data) }
    resolve({ result: { data: { conversations: [conv('late')], nextCursor: null, hasMore: false } } })
    await pending
    assert.equal(writes, 0)
    page.setData = original
  }
})

test('directory service rejects malformed payloads and strips private anonymous fields', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const service = r.load('apps/miniprogram/services/messages.ts')
  const summary = { peer: { nickname: '匿名用户', avatar_url: '' },
    lastMessage: { _id: 'message', content: 'hello', created_at: '2026-09-21T01:00:00.000Z', from: 'secret-peer', anonymous_context: { target_openid: 'secret-peer' } },
    unreadCount: 1, chat_target: { anonymous: true, thread_id: 'a'.repeat(64) } }
  let payload = { conversations: [summary], hasMore: false, nextCursor: null }
  r.wx.cloud.callFunction = async () => ({ result: { data: payload } })
  const response = await service.listConversations()
  assert.equal(JSON.stringify(response).includes('secret-peer'), false)
  assert.deepEqual(Object.keys(response.conversations[0].lastMessage).sort(), ['_id', 'content', 'created_at'])
  for (const invalid of [null, {}, { ...payload, hasMore: true },
    { ...payload, conversations: [{ ...summary, unreadCount: -1 }] },
    { ...payload, conversations: [{ ...summary, lastMessage: { ...summary.lastMessage, created_at: 'yesterday' } }] }]) {
    payload = invalid
    await assert.rejects(service.listConversations(), error => error.code === 'INVALID_RESPONSE')
  }
})

test('chat loads earlier pages and ignores history errors after hiding', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  r.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const page = r.env.page
  page.data.peerOpenid = 'bob-user'
  page.data.myOpenid = 'alice'
  page.startPolling = () => {}
  const cursor = sequence => ({ version: 2, conversation_id: 'conversation', sequence })
  const message = sequence => ({ _id: `m${sequence}`, msg_id: `r${sequence}`, from: 'bob-user', to: 'alice', content: 'hello',
    status: 'read', created_at: '2026-09-21T01:00:00.000Z', conversation_id: 'conversation', sync_sequence: sequence })
  r.wx.cloud.callFunction = async args => ({ result: { data: args.data.before
    ? { messages: [message(1), message(2)], hasMore: false, nextBefore: null, sync_cursor: cursor(2) }
    : { messages: [message(3), message(4)], hasMore: true, nextBefore: cursor(3), sync_cursor: cursor(4) } } })
  await page.loadMessages()
  assert.equal(page._syncCursor.sequence, 4)
  assert.equal(page.data.scrollTo, 'msg-m4')
  await page.onLoadEarlier()
  assert.equal(page.data.messages.map(m => m.sync_sequence).join(','), '1,2,3,4')
  assert.equal(page.data.scrollTo, 'msg-m3')
  assert.equal(page._syncCursor.sequence, 4)
  assert.equal(page.data.hasMoreHistory, false)
  page.data.historyCursor = cursor(1)
  let reject
  r.wx.cloud.callFunction = () => new Promise((_, fail) => { reject = fail })
  const pending = page.onLoadEarlier()
  page.onHide()
  page.setData = () => { throw new Error('Disposed page write') }
  reject(new Error('network'))
  await pending
})

test('chat send does not render or notify after page disposal', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  r.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const page = r.env.page
  page.data.peerOpenid = 'bob-user'
  page.data.inputText = 'hello'
  let resolve
  r.wx.cloud.callFunction = () => new Promise(done => { resolve = done })
  const pending = page.onSend()
  page.onUnload()
  page.setData = () => { throw new Error('Disposed page write') }
  resolve({ result: { data: { message: { _id: 'late' } } } })
  await pending
})

test('cloud history adapter scopes sequence queries and returns a usable history cursor', async () => {
  const { stableDocumentId } = require('../apps/cloudfunctions/common')
  const conversationId = stableDocumentId('conversation', 'direct', 'alice', 'bob-user')
  const messages = [1, 2, 3].map(sequence => ({ _id: `h${sequence}`, msg_id: `r${sequence}`, from: 'alice', to: 'bob-user',
    content: 'hello', status: 'sent', created_at: new Date('2026-09-21T01:00:00.000Z'), conversation_id: conversationId, sync_sequence: sequence }))
  const db = { command: { lt: value => ({ lt: value }) }, collection(name) {
    assert.equal(name, 'messages')
    let condition, take
    return { where(value) { condition = value; return this }, orderBy(field, direction) {
      assert.equal(field, 'sync_sequence'); assert.equal(direction, 'desc'); return this
    }, limit(value) { take = value; return this }, async get() {
      assert.equal(condition.conversation_id, conversationId)
      return { data: [...messages].reverse().filter(m => !condition.sync_sequence || m.sync_sequence < condition.sync_sequence.lt).slice(0, take) }
    } }
  } }
  const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const first = await main({ action: 'getConversation', peer: 'bob-user', limit: 2 })
  assert.equal(first.data.sync_cursor.sequence, 3)
  assert.equal(first.data.nextBefore.sequence, 2)
  const second = await main({ action: 'getConversation', peer: 'bob-user', limit: 2, before: first.data.nextBefore })
  assert.equal(second.data.messages[0]._id, 'h1')
  assert.equal(second.data.hasMore, false)
})

test('message poller retries the whole unconsumed batch after a later page fails', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const cursor = sequence => ({ version: 2, conversation_id: 'conversation', sequence })
  const message = sequence => ({ _id: `p${sequence}`, msg_id: `request${sequence}`, from: 'alice', to: 'bob-user', content: 'hello',
    status: 'sent', created_at: '2026-09-21T01:00:00.000Z', conversation_id: 'conversation', sync_sequence: sequence })
  const requests = [], updates = [], errors = []
  let failSecond = true
  r.wx.cloud.callFunction = async args => {
    const sequence = args.data.cursor.sequence
    requests.push(sequence)
    if (sequence === 1 && failSecond) { failSecond = false; throw new Error('network') }
    const messages = sequence < 2 ? [message(sequence + 1)] : []
    return { result: { data: { messages, hasMore: sequence === 0, nextCursor: cursor(Math.min(sequence + 1, 2)) } } }
  }
  const watcher = r.load('apps/miniprogram/services/watch.ts').pollMessages('bob-user', cursor(0), messages => updates.push(messages), error => errors.push(error))
  const poll = [...r.timers.values()][0]
  await poll()
  assert.equal(updates.length, 0)
  assert.equal(errors.length, 1)
  await poll()
  assert.equal(updates[0].map(m => m.sync_sequence).join(','), '1,2')
  await poll()
  assert.deepEqual(requests, [0, 1, 0, 1, 2])
  watcher.stop()
})

test('comment poller retains its cursor until accumulated changes are delivered', async () => {
  const r = runtime()
  const requests = [], changes = []
  let failSecond = true
  r.wx.cloud.callFunction = async args => {
    if (args.data.action === 'list') return { result: { data: { items: [], total: 0, hasMore: false, nextCursor: null,
      syncCursor: { version: 1, post_id: 'post', sequence: 0 } } } }
    const sequence = args.data.cursor.sequence
    requests.push(sequence)
    if (sequence === 1 && failSecond) { failSecond = false; throw new Error('network') }
    return { result: { data: { changes: [{ comment_id: `c${sequence + 1}`, sequence: sequence + 1, type: 'created', comment: {
      _id: `c${sequence + 1}`, post_id: 'post', parent_id: null, depth: 0, content: 'Comment', anonymous: true,
      is_mine: false, status: 'published', created_at: '2026-09-21T00:00:00.000Z', author: { nickname: '匿名用户', avatar_url: '' },
    } }],
      has_more: sequence === 0, next_cursor: { version: 1, post_id: 'post', sequence: sequence + 1 } } } }
  }
  const watcher = r.load('apps/miniprogram/composition/comment-thread.ts').createCommentThread(state => {
    if (state.comments.length) changes.push(state.comments)
  })
  await watcher.refresh('post')
  await tick()
  assert.equal(changes.length, 0)
  await [...r.timers.values()][0]()
  assert.deepEqual(requests, [0, 1, 0, 1])
  assert.equal(changes[0].map(c => c._id).join(','), 'c1,c2')
  watcher.dispose()
})

test('message sync client rejects cursor jumps, wrong scopes and non-progressing pages', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const cursor = { version: 2, conversation_id: 'conversation', sequence: 4 }
  const service = r.load('apps/miniprogram/services/messages.ts')
  for (const payload of [
    { messages: [], hasMore: false, nextCursor: { ...cursor, sequence: 5 } },
    { messages: [], hasMore: false, nextCursor: { ...cursor, conversation_id: 'other' } },
    { messages: [], hasMore: true, nextCursor: cursor },
  ]) {
    r.wx.cloud.callFunction = async () => ({ result: { data: payload } })
    await assert.rejects(service.syncConversation('bob-user', cursor), error => error.code === 'INVALID_RESPONSE')
  }
})

test('read service splits large batches and stops after account changes', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  const service = r.load('apps/miniprogram/services/messages.ts')
  const ids = Array.from({ length: 250 }, (_, i) => `m${i}`)
  const batches = []
  r.wx.cloud.callFunction = async args => {
    batches.push(args.data.msgIds)
    assert.ok(args.data.msgIds.length <= 20)
    return { result: { data: { updated: args.data.msgIds.length } } }
  }
  assert.equal(await service.markRead('bob-user', [...ids, ids[0]]), 250)
  assert.equal(batches.length, 13)
  assert.equal(new Set(batches.flat()).size, 250)
  batches.length = 0
  assert.equal(await service.markRead('bob-user', []), 0)
  assert.equal(batches.length, 0)
  let complete
  r.wx.cloud.callFunction = args => { batches.push(args.data.msgIds); return new Promise(done => { complete = done }) }
  const pending = service.markRead('bob-user', ids)
  session.set({ ...profile, _openid: 'another', verified: true })
  complete({ result: { data: { updated: 20 } } })
  await assert.rejects(pending, /会话已变更/)
  assert.equal(batches.length, 1)
})

test('receipt polling rotates bounded batches and discards a late reply after stopping', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const cursor = { version: 2, conversation_id: 'conversation', sequence: 0 }
  const ids = Array.from({ length: 25 }, (_, i) => `sent${i}`)
  const batches = [], received = []
  r.wx.cloud.callFunction = async args => {
    if (args.data.action === 'syncConversation') return { result: { data: { messages: [], hasMore: false, nextCursor: cursor } } }
    assert.equal(args.data.action, 'getReadReceipts')
    batches.push(args.data.msgIds)
    return { result: { data: { readIds: args.data.msgIds } } }
  }
  const watcher = r.load('apps/miniprogram/services/watch.ts').pollMessages('bob-user', cursor, () => {}, () => {}, null,
    { pending: () => ids, apply: batch => received.push(batch) })
  const poll = [...r.timers.values()][0]
  await poll()
  await poll()
  assert.ok(batches.every(batch => batch.length === 20))
  assert.equal(new Set(batches.flat()).size, 25)
  let complete
  r.wx.cloud.callFunction = async args => args.data.action === 'syncConversation'
    ? { result: { data: { messages: [], hasMore: false, nextCursor: cursor } } }
    : new Promise(resolve => { complete = () => resolve({ result: { data: { readIds: args.data.msgIds } } }) })
  const pending = poll()
  await tick()
  watcher.stop()
  complete()
  await pending
  assert.equal(received.length, 2)
})

test('late message snapshots cannot regress a displayed read receipt', () => {
  const r = runtime()
  const { mergeChatMessages } = r.load('apps/miniprogram/services/message-state.ts')
  const read = { _id: 'm1', sync_sequence: 1, status: 'read' }
  const merged = mergeChatMessages([read], [{ ...read, status: 'sent' }, { _id: 'm2', sync_sequence: 2, status: 'sent' }])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].status, 'read')
  assert.equal(merged[1].status, 'sent')
})

test('cloud read receipt query binds sender and conversation to the caller', async () => {
  const { stableDocumentId } = require('../apps/cloudfunctions/common')
  const db = { command: { in: ids => ids }, collection(name) {
    assert.equal(name, 'messages')
    return { where(condition) {
      assert.equal(condition.from, 'alice')
      assert.equal(condition.status, 'read')
      assert.equal(condition.conversation_id, stableDocumentId('conversation', 'direct', 'alice', 'bob-user'))
      assert.equal(condition._id.join(','), 'sent')
      return { limit: count => { assert.equal(count, 1); return { get: async () => ({ data: [] }) } } }
    } }
  } }
  const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const result = await main({ action: 'getReadReceipts', peer: 'bob-user', from: 'mallory', msgIds: ['sent'] })
  assert.equal(result.data.readIds.length, 0)
})

test('read acknowledgements persist across restart and retry only in their own account', async () => {
  let now = 1000
  const r = runtime()
  r.env.Date = class extends Date { static now() { return now } }
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  r.wx.cloud.callFunction = async () => { throw new Error('network') }
  const queue = r.load('apps/miniprogram/services/read-queue.ts')
  await queue.acknowledgeMessages('bob-user', ['m1', 'm1'])
  const key = 'pending_message_reads_v2:alice'
  assert.equal(r.storage.get(key).jobs.length, 1)
  assert.equal(r.storage.get(key).jobs[0].ids.length, 1)
  assert.ok(r.storage.get(key).jobs[0].retryAt > now)
  let calls = 0
  r.wx.cloud.callFunction = async () => { calls++; return { result: { data: { updated: 1 } } } }
  await queue.flushReadAcknowledgements()
  assert.equal(calls, 0)
  const restarted = runtime()
  restarted.env.Date = class extends Date { static now() { return now } }
  restarted.storage.set(key, structuredClone(r.storage.get(key)))
  const session = restarted.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, _openid: 'bob', verified: true })
  const restored = restarted.load('apps/miniprogram/services/read-queue.ts')
  restarted.wx.cloud.callFunction = async args => {
    calls++
    assert.equal(args.data.peer, 'bob-user')
    return { result: { data: { updated: 1 } } }
  }
  now += 10000
  await restored.flushReadAcknowledgements()
  assert.equal(calls, 0)
  session.set({ ...profile, verified: true })
  await restored.flushReadAcknowledgements()
  assert.equal(calls, 1)
  assert.equal(restarted.storage.has(key), false)
  assert.equal(restarted.timers.size, 0)
})

test('read retry draining pauses between batches and resumes without dropping pending IDs', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const queue = r.load('apps/miniprogram/services/read-queue.ts')
  let complete
  const requests = []
  r.wx.cloud.callFunction = args => { requests.push(args.data); return new Promise(resolve => { complete = resolve }) }
  const pending = queue.acknowledgeMessages('bob-user', Array.from({ length: 45 }, (_, i) => `m${i}`))
  queue.setReadQueueActive(false)
  complete({ result: { data: { updated: 20 } } })
  await pending
  assert.equal(requests.length, 1)
  assert.equal(r.storage.get('pending_message_reads_v2:alice').jobs.flatMap(job => job.ids).length, 25)
  await queue.flushReadAcknowledgements()
  assert.equal(requests.length, 1)
  queue.setReadQueueActive(true)
  r.wx.cloud.callFunction = async args => { requests.push(args.data); return { result: { data: { updated: args.data.msgIds.length } } } }
  await queue.flushReadAcknowledgements()
  assert.equal(requests.length, 3)
  assert.equal(r.storage.has('pending_message_reads_v2:alice'), false)
})

test('read queue retains memory on storage failure and rejects corrupt stored jobs', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const queue = r.load('apps/miniprogram/services/read-queue.ts')
  const original = r.wx.setStorageSync
  r.wx.setStorageSync = () => { throw new Error('storage full') }
  await assert.rejects(queue.acknowledgeMessages('bob-user', ['m1']), /storage full/)
  assert.equal(r.calls.length, 0)
  r.wx.setStorageSync = original
  let requests = 0
  r.wx.cloud.callFunction = async () => { requests++; return { result: { data: { updated: 1 } } } }
  await queue.flushReadAcknowledgements()
  assert.equal(requests, 1)
  const corrupt = runtime()
  corrupt.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  corrupt.storage.set('pending_message_reads_v2:alice', { version: 1, jobs: [{ ids: ['m1'], peer: null, target: null }] })
  await assert.rejects(corrupt.load('apps/miniprogram/services/read-queue.ts').flushReadAcknowledgements())
  assert.equal(corrupt.calls.length, 0)
  assert.equal(corrupt.storage.has('pending_message_reads_v2:alice'), true)
})

test('anonymous history returns a stable public target without consulting deleted source content', async () => {
  const { stableDocumentId: hash } = require('../apps/cloudfunctions/common')
  const thread = hash('anonymous_chat', 'post', 'post', 'alice', 'bob-user')
  const conversationId = hash('conversation', 'anonymous', thread)
  const db = { command: {}, collection(name) {
    if (name === 'conversation_entries') return { doc: id => {
      assert.equal(id, hash('conversation_entry', 'alice', conversationId))
      return { get: async () => ({ data: { owner_openid: 'alice', peer_openid: 'bob-user', conversation_id: conversationId,
        anonymous_context: { protocol_version: 3, source_type: 'post', source_id: 'post', target_openid: 'bob-user', initiator_openid: 'alice', thread_id: thread, initiator_visibility: 'anonymous', target_visibility: 'anonymous' } } }) }
    } }
    assert.equal(name, 'messages')
    return { where: condition => {
      assert.equal(condition.conversation_id, conversationId)
      return { orderBy: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }
    } }
  } }
  const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const response = await main({ action: 'getConversation', anonymous_target: { thread_id: thread } })
  assert.equal(response.data.chat_target.thread_id, thread)
  assert.equal(JSON.stringify(response).includes('bob-user'), false)
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  r.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  r.env.page.data.anonymousTarget = { anonymous: true, type: 'post', id: 'post' }
  r.env.page.startPolling = () => {}
  r.wx.cloud.callFunction = async () => ({ result: response })
  await r.env.page.loadMessages()
  assert.equal(r.env.page.data.anonymousTarget.thread_id, thread)
})

test('both notification pages append tied-time pages and acknowledge only loaded IDs', async () => {
  for (const file of ['messages/messages', 'notifications/notifications']) {
    const r = runtime()
    r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
    r.load(`apps/miniprogram/pages/${file}.ts`)
    const page = r.env.page
    page.data.activeTab = 'notif'
    page.loadNotifBadge = async () => {}
    const date = '2026-09-21T00:00:00.000Z'
    const row = id => ({ _id: id, type: 'comment', actor: { nickname: 'Alice', avatar_url: '' }, anonymous: false, read: false, created_at: date })
    const batches = []
    r.wx.cloud.callFunction = async ({ data }) => {
      if (data.action === 'markNotificationsRead') {
        batches.push(Array.from(data.notificationIds))
        return { result: { data: { updated: data.notificationIds.length } } }
      }
      assert.equal(data.action, 'listNotifications')
      if (data.cursor) assert.equal(data.cursor.id, 'n2')
      return { result: { data: data.cursor
        ? { notifications: [row('n1')], hasMore: false, nextCursor: null }
        : { notifications: [row('n3'), row('n2')], hasMore: true, nextCursor: { version: 1, scope: 'a'.repeat(64), id: 'n2', createdAt: date } } } }
    }
    await page.loadNotifications(true)
    await page.loadNotifications()
    assert.deepEqual(Array.from(page.data.notifications, row => row._id), ['n3', 'n2', 'n1'])
    assert.ok(page.data.notifications.every(row => row.read))
    assert.deepEqual(batches, [['n3', 'n2'], ['n1']])
    let complete
    r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
    const pending = page.loadNotifications(true)
    page.onHide()
    let writes = 0
    page.setData = () => { writes++ }
    complete({ result: { data: { notifications: [], hasMore: false, nextCursor: null } } })
    await pending
    assert.equal(writes, 0)
  }
})

test('notification cloud adapter binds pagination and updates to the authenticated recipient', async () => {
  const conditions = [], orders = []
  let limit
  const command = { lt: value => ({ lt: value }), in: value => ({ in: value }),
    and: value => ({ and: value }), or: value => ({ or: value }) }
  const query = { where(value) { conditions.push(value); return this },
    orderBy(key, direction) { orders.push([key, direction]); return this },
    limit(value) { limit = value; return this }, async get() { return { data: [] } },
    async update(value) { assert.equal(value.data.read, true); return { stats: { updated: 1 } } } }
  const db = { command, collection(name) { assert.equal(name, 'notifications'); return query } }
  const main = cloudHandler('messages', db, {}, { authorizeAction: async () => ({ allowed: true }) })
  const { createHash } = require('node:crypto')
  const scope = createHash('sha256').update(['notifications', 'alice', 'all'].join('\0')).digest('hex')
  const cursor = { version: 1, scope, id: 'n2', createdAt: '2026-09-21T00:00:00.000Z' }
  const result = await main({ action: 'listNotifications', cursor, to: 'mallory' })
  assert.equal(result.data.notifications.length, 0)
  assert.equal(conditions[0].and[0].to, 'alice')
  assert.equal(conditions[0].and[1].or[1]._id.lt, 'n2')
  assert.equal(conditions[0].and[1].or[0].created_at.lt.toISOString(), cursor.createdAt)
  assert.deepEqual(orders, [['created_at', 'desc'], ['_id', 'desc']])
  assert.equal(limit, 21)
  const marked = await main({ action: 'markNotificationsRead', notificationIds: ['n1'], to: 'mallory' })
  assert.equal(marked.data.updated, 1)
  assert.equal(conditions[1].to, 'alice')
  assert.equal(conditions[1].read, false)
  assert.deepEqual(Array.from(conditions[1]._id.in), ['n1'])
  const rejected = await main({ action: 'markNotificationsRead' })
  assert.equal(rejected.code, 'INVALID_INPUT')
  assert.equal(conditions.length, 2)
})

test('draft client rejects obsolete servers and ignores account-switched responses', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  const drafts = r.load('apps/miniprogram/services/drafts.ts')
  r.wx.cloud.callFunction = async () => ({ result: { error: 'missing', code: 'UNKNOWN_ACTION' } })
  await assert.rejects(drafts.listDrafts(), error => error.code === 'UNKNOWN_ACTION')
  assert.ok(![...r.storage.keys()].some(key => key.startsWith('local_drafts_fallback:')))
  let complete
  r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
  const pending = drafts.listDrafts()
  session.set({ ...profile, _openid: 'bob', verified: true })
  complete({ result: { data: { drafts: [] } } })
  await assert.rejects(pending, /会话已变更/)
  r.wx.cloud.callFunction = async () => ({ result: { data: { drafts: [{ _id: 'invalid' }] } } })
  await assert.rejects(drafts.listDrafts(), error => error.code === 'INVALID_RESPONSE')
})

test('post mutation receipts reject malformed or unrelated confirmations and expose only receipt fields', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  const posts = r.load('apps/miniprogram/services/posts.ts')
  const good = { post: { _id: 'post', revision: 1, status: 'published', request_fingerprint: 'secret' }, flagged: false, status: 'created' }
  let response = good
  r.wx.cloud.callFunction = async () => ({ result: { data: response } })
  const confirmed = await posts.createPost({ title: 't', content: 'c' }, false, 'request-id')
  assert.equal(confirmed.post._id, 'post')
  assert.equal('request_fingerprint' in confirmed.post, false)
  for (const invalid of [{}, { ...good, status: 'unknown' }, { ...good, flagged: true },
    { ...good, post: { ...good.post, revision: 0 } }, { ...good, post: { ...good.post, _id: '' } }]) {
    response = invalid
    await assert.rejects(posts.createPost({ title: 't', content: 'c' }, false, 'request-id'), error => error.code === 'INVALID_RESPONSE')
  }
  response = good
  await assert.rejects(posts.updatePost('another-post', { title: 't', content: 'c' }, false, 1), error => error.code === 'INVALID_RESPONSE')
  let complete
  r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
  const pending = posts.createPost({ title: 't', content: 'c' }, false, 'request-id')
  session.set({ ...profile, _openid: 'bob', verified: true })
  complete({ result: { data: good } })
  await assert.rejects(pending, /会话已变更/)
})

test('draft cleanup survives restart, respects revisions and pauses between jobs', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  const queue = r.load('apps/miniprogram/services/draft-cleanup.ts')
  queue.enqueueDraftCleanup('draft-one', 2)
  queue.enqueueDraftCleanup('draft-one', 2)
  queue.enqueueDraftCleanup('draft-two', 3)
  assert.equal(r.storage.get('draft_cleanup_v1:alice').length, 2)
  const restored = runtime()
  for (const [key, value] of r.storage) restored.storage.set(key, value)
  restored.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const q = restored.load('apps/miniprogram/services/draft-cleanup.ts')
  const calls = []
  restored.wx.cloud.callFunction = async ({ data }) => {
    calls.push(data)
    q.setDraftCleanupActive(false)
    return { result: { data: { deleted: true } } }
  }
  await q.flushDraftCleanup()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].expected_revision, 2)
  // The confirmation arrived after pausing; an idempotent retry is retained.
  assert.equal(restored.storage.get('draft_cleanup_v1:alice').length, 2)
  q.setDraftCleanupActive(true)
  restored.wx.cloud.callFunction = async ({ data }) => ({ result: data.draft_id === 'draft-two'
    ? { error: 'newer draft', code: 'DRAFT_CONFLICT' } : { data: { deleted: true } } })
  await q.flushDraftCleanup()
  assert.equal(restored.storage.get('draft_cleanup_v1:alice').length, 0)
  assert.equal(r.storage.get('draft_cleanup_v1:alice').length, 2)
  session.set({ ...profile, _openid: 'bob', verified: true })
  let foreignCalls = 0
  r.wx.cloud.callFunction = async () => { foreignCalls++; return { result: { data: { deleted: true } } } }
  await queue.flushDraftCleanup()
  assert.equal(foreignCalls, 0)
})

test('draft cleanup retains failed deletions with backoff and rejects unsafe queue data', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  const queue = r.load('apps/miniprogram/services/draft-cleanup.ts')
  queue.enqueueDraftCleanup('draft', 1)
  let calls = 0
  r.wx.cloud.callFunction = async () => { calls++; throw Error('offline') }
  await queue.flushDraftCleanup()
  await queue.flushDraftCleanup()
  assert.equal(calls, 1)
  assert.equal(r.storage.get('draft_cleanup_v1:alice')[0].attempts, 1)
  r.storage.set('draft_cleanup_v1:alice', [{ id: 'draft', revision: 0 }])
  await assert.rejects(queue.flushDraftCleanup(), /Invalid cleanup job/)
  assert.equal(calls, 1)
})

test('background account changes cannot restart foreground maintenance polling', async () => {
  const r = runtime()
  r.load('apps/miniprogram/app.ts')
  r.app.onLaunch()
  r.app.onShow()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  assert.equal(r.timers.size, 1)
  r.app.onHide()
  session.set({ ...profile, _openid: 'bob', verified: true })
  assert.equal(r.timers.size, 0)
  r.app.onShow()
  assert.equal(r.timers.size, 1)
  r.app.onHide()
})

test('public author lists exclude anonymous posts even for the author; private lists bind the caller', async () => {
  const conditions = []
  const db = { command: { in: values => ({ in: values }) }, collection: () => ({
    where(condition) {
      conditions.push(condition)
      const query = { orderBy: () => query, skip: () => query, limit: () => query,
        get: async () => ({ data: [] }), count: async () => ({ total: 0 }) }
      return query
    },
  }) }
  const main = cloudHandler('posts', db, {}, { authorizeAction: async () => ({ allowed: true, user: { _openid: 'alice', verified: true } }) })
  const publicResult = await main({ action: 'list', author_openid: 'alice' })
  assert.equal(publicResult.data.items.length, 0)
  assert.equal(conditions[0].anonymous, false)
  assert.equal(conditions[0]._openid, 'alice')
  conditions.length = 0
  await main({ action: 'listMine', author_openid: 'bob', openid: 'bob' })
  assert.equal(conditions[0]._openid, 'alice')
  assert.equal(conditions[0].anonymous, undefined)
  assert.deepEqual(Array.from(conditions[0].status.in), ['published', 'flagged'])
  assert.equal((await main({ action: 'listMine', public_only: true })).code, 'FORBIDDEN')
})

test('private post lists require verification and search rejects malformed response payloads', async () => {
  const db = { command: {}, collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [{ _openid: 'alice', verified: false }] }) }) }) }) }
  assert.equal((await cloudHandler('posts', db)({ action: 'listMine' })).code, 'EMAIL_NOT_VERIFIED')
  const r = runtime()
  const posts = r.load('apps/miniprogram/services/posts.ts')
  await assert.rejects(posts.listMyPosts(), error => error.code === 'EMAIL_NOT_VERIFIED')
  assert.equal(r.calls.length, 0)
  r.wx.cloud.callFunction = async () => ({ result: { data: { items: [{ _id: 'bad' }], total: 1, hasMore: false } } })
  await assert.rejects(posts.searchPosts('campus'), error => error.code === 'INVALID_RESPONSE')
  r.wx.cloud.callFunction = async () => ({ result: { data: { items: [], total: 0, hasMore: false, nextCursor: null } } })
  assert.equal((await posts.searchPosts('campus')).items.length, 0)
})

test('my posts clears private state on account change and rejects late list results', async () => {
  const r = runtime()
  const session = r.load('apps/miniprogram/services/session.ts')
  session.set({ ...profile, verified: true })
  r.load('apps/miniprogram/pages/my-posts/my-posts.ts')
  const page = r.env.page
  let complete
  r.wx.cloud.callFunction = ({ data }) => {
    assert.equal(data.action, 'listMine')
    return new Promise(resolve => { complete = resolve })
  }
  page.onShow()
  page.data.posts = [{ _id: 'private' }]
  session.set({ ...profile, _openid: 'bob', verified: true })
  assert.equal(page.data.posts.length, 0)
  let writes = 0
  page.setData = () => { writes++ }
  complete({ result: { data: { items: [], total: 0, hasMore: false } } })
  await tick()
  assert.equal(writes, 0)
  page.onUnload()
})

test('my posts retries the same cursor after failure and ignores hidden-page results', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  r.load('apps/miniprogram/pages/my-posts/my-posts.ts')
  const page = r.env.page
  const stamp = '2026-09-21T00:00:00.000Z'
  const post = id => ({ _id: id, is_mine: true, title: 'Title', content: 'Body', category_id: '', category: null,
    anonymous: true, status: 'published', revision: 1, view_count: 0, comment_count: 0, created_at: stamp, updated_at: stamp })
  const cursor = { version: 1, scope: 'a'.repeat(64), createdAt: stamp, id: 'b' }
  const requests = []
  let fail = true
  r.wx.cloud.callFunction = async ({ data }) => {
    requests.push(data.cursor)
    if (data.cursor && fail) throw Error('offline')
    return { result: { data: data.cursor
      ? { items: [post('a')], total: 2, hasMore: false, nextCursor: null }
      : { items: [post('b')], total: 2, hasMore: true, nextCursor: cursor } } }
  }
  await page.loadPosts()
  await page.loadPosts(false)
  assert.equal(page.data.posts.length, 1)
  assert.equal(page.data.cursor.id, 'b')
  assert.equal(page.data.loadError, true)
  fail = false
  page.onRetry()
  await tick()
  assert.equal(page.data.posts.map(p => p._id).join(','), 'b,a')
  assert.equal(JSON.stringify(requests[1]), JSON.stringify(requests[2]))
  assert.equal(page.data.hasMore, false)
  let complete
  r.wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve })
  const pending = page.loadPosts()
  page.onHide()
  let writes = 0
  page.setData = () => { writes++ }
  complete({ result: { data: { items: [], total: 0, hasMore: false, nextCursor: null } } })
  await pending
  assert.equal(writes, 0)
})


test('chat entry snapshots anonymity and each new opening receives a fresh initiation, existing threads stay fixed', () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set({ ...profile, verified: true })
  r.storage.set('anonymous_mode', true)
  r.load('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const page = r.env.page
  const first = page.buildAnonymousTarget({ peer: 'bob-user' })
  const second = page.buildAnonymousTarget({ peer: 'bob-user' })
  assert.equal(first.type, 'user')
  assert.notEqual(first.initiation_id, second.initiation_id)
  assert.equal(page.buildAnonymousTarget({ peer: 'bob-user', existing: '1' }), null)
  const thread = page.buildAnonymousTarget({ anon_thread: 'a'.repeat(64) })
  assert.deepEqual(JSON.parse(JSON.stringify(thread)), { anonymous: true, thread_id: 'a'.repeat(64) })
  r.storage.set('anonymous_mode', false)
  assert.equal(page.buildAnonymousTarget({ peer: 'bob-user' }), null)
  assert.equal(page.buildAnonymousTarget({ anon_type: 'post', anon_id: 'public-post' }).type, 'post')
  assert.equal(page.buildAnonymousTarget({ anon_type: 'comment', anon_id: 'public-comment' }).type, 'comment')
  assert.equal(first.type, 'user', 'later global mode changes never mutate the captured channel')
})
