import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import automator from 'miniprogram-automator'
import { configureProject } from './configure-project.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = configureProject(root, true)
const port = process.env.WECHAT_AUTOMATION_PORT || '9420'
if (!/^\d{1,5}$/.test(port)) throw new Error('Invalid WECHAT_AUTOMATION_PORT')
const results = []
let mini
let identity
async function bounded(promise, milliseconds = 25000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
async function check(name, action) {
  try { await bounded(action()); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) {
    // No user profile, content or backend error payload is written to evidence.
    const reason = error instanceof Error && /^(TIMEOUT|[A-Z_]+)$/.test(error.message) ? error.message : 'ASSERTION_OR_PLATFORM_FAILURE'
    results.push({ name, passed: false, reason }); console.log(`FAIL ${name}: ${reason}`)
  }
}
async function cloud(name, data) {
  return mini.evaluate(async (functionName, payload) => {
    try { return (await wx.cloud.callFunction({ name: functionName, data: payload })).result }
    catch (_) { return { error: true, code: 'CLOUD_TRANSPORT_FAILED' } }
  }, name, data)
}
function data(response) {
  if (!response || response.error) throw new Error(response?.code || 'INVALID_RESPONSE')
  assert.ok(response.data)
  return response.data
}
try {
  mini = await bounded(automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` }), 10000)
  await check('runtime uses LynkU AppID', async () => {
    const appId = await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId)
    assert.equal(appId, config.appId)
  })
  await check('real WeChat identity restores without privilege changes', async () => {
    identity = data(await cloud('users', { action: 'ensure' })).user
    assert.equal(typeof identity?._openid, 'string')
    assert.equal(typeof identity?.verified, 'boolean')
  })
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'config/cloudbase-schema.json'), 'utf8'))
  for (const collection of schema.collections.filter(item => item.clientPermission === 'admin-only')) {
    await check(`direct client read denied: ${collection.name}`, async () => {
      const denied = await mini.evaluate(async name => {
        try {
          // Project only the ID and never return records through the automation connection.
          await wx.cloud.database().collection(name).field({ _id: true }).limit(1).get()
          return false
        } catch (error) {
          // Network failures and missing collections must not count as permission evidence.
          return /permission denied|DATABASE_PERMISSION_DENIED/i.test(String(error?.errMsg || error?.message || ''))
        }
      }, collection.name)
      if (!denied) throw new Error('DATABASE_PERMISSION_NOT_ENFORCED')
    })
  }
  await check('categories public read', async () => {
    assert.ok(Array.isArray(data(await cloud('categories', { action: 'list' })).categories))
  })
  await check('posts public read and anonymous projection', async () => {
    const page = data(await cloud('posts', { action: 'list', public_only: true, limit: 5, offset: 0 }))
    assert.ok(Array.isArray(page.items))
    for (const post of page.items) if (post.anonymous) assert.ok(!post._openid && !post.author?.openid && !post.author?._openid)
  })
  if (identity && !identity.verified) await check('unverified account cannot read private conversations', async () => {
    const response = await cloud('messages', { action: 'listConversations' })
    assert.equal(response.code, 'EMAIL_NOT_VERIFIED')
  })
  if (config.emailVerificationEnabled && identity && !identity.verified) await check('email verification enabled with server input validation', async () => {
    const response = await cloud('users', { action: 'sendEmailCode', email: 'invalid' })
    assert.equal(response.code, 'INVALID_EMAIL')
  })
  await check('temporary maintenance action removed', async () => {
    assert.equal((await cloud('categories', { action: '__restricted_setup' })).code, 'UNKNOWN_ACTION')
  })
  await check('home renders a successful response', async () => {
    const page = await mini.reLaunch('/pages/index/index')
    assert.ok(page)
    await page.waitFor(async () => (await page.data('state')) !== 'loading')
    assert.ok(['empty', 'success', 'loaded'].includes(await page.data('state')))
  })
  await check('profile and settings routes render', async () => {
    const page = await mini.switchTab('/pages/profile/profile')
    assert.equal(page?.path, 'pages/profile/profile')
    const settings = await mini.navigateTo('/pages/settings/settings')
    assert.equal(await settings?.data('appName'), config.name)
  })
  await mini.switchTab('/pages/index/index')
} catch (_) {
  results.push({ name: 'automation connection', passed: false, reason: 'AUTOMATION_UNAVAILABLE' })
} finally {
  mini?.disconnect()
  fs.mkdirSync(path.join(root, 'dist/demo'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist/demo/smoke.json'), JSON.stringify({ timestamp: new Date().toISOString(), appId: config.appId,
    environment: config.cloudEnvironment, passed: results.length > 0 && results.every(item => item.passed), checks: results }, null, 2) + '\n')
  if (!results.length || results.some(item => !item.passed)) process.exitCode = 1
}
