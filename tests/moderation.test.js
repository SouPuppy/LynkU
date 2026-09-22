const test = require('node:test')
const assert = require('node:assert/strict')
const { moderateText: runModeration } = require('@lynku/server')
const { wechatTextSafety } = require('@lynku/adapters')
const realClock = { now: () => performance.now(), schedule: (ms, callback) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) } }
const moderateText = (port, ...args) => runModeration({ clock: realClock, ...port }, ...args)
const pass = { errcode: 0, result: { suggest: 'pass' } }
function clockFixture() {
  let now = 0
  const timers = new Set()
  return {
    now: () => now,
    schedule(ms, callback) { const timer = { at: now + ms, callback }; timers.add(timer); return () => timers.delete(timer) },
    advance(ms, fire = true) { now += ms; if (fire) for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.callback() } },
    pending: () => timers.size,
  }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

test('timeout stops the submission and late passes cannot start more checks', async () => {
  const clock = clockFixture(), resolvers = []
  const operation = moderateText({ clock, check: () => new Promise(resolve => resolvers.push(resolve)) }, 'owner', 3, '文'.repeat(10000))
  const rejected = assert.rejects(operation, { code: 'MODERATION_UNAVAILABLE' })
  assert.equal(resolvers.length, 2)
  clock.advance(6000)
  await rejected
  for (const resolve of resolvers) resolve(pass)
  await flush()
  assert.equal(resolvers.length, 2)
  assert.equal(clock.pending(), 0)
})

test('all segments share one deadline rather than receiving a fresh total budget', async () => {
  const clock = clockFixture(), resolvers = []
  const operation = moderateText({ clock, check: () => new Promise(resolve => resolvers.push(resolve)) }, 'owner', 3, '文'.repeat(10000))
  const rejected = assert.rejects(operation, { code: 'MODERATION_UNAVAILABLE' })
  for (let batch = 0; batch < 3; batch++) {
    clock.advance(5000)
    resolvers[batch * 2](pass); resolvers[batch * 2 + 1](pass)
    await flush()
  }
  assert.equal(resolvers.length, 8)
  clock.advance(5000)
  await rejected
  for (const resolve of resolvers) resolve(pass)
  await flush()
  assert.equal(resolvers.length, 8)
  assert.equal(clock.pending(), 0)
})

test('expired SDK success is rejected even when the timer callback has not run', async () => {
  const clock = clockFixture()
  await assert.rejects(moderateText({ clock, check: async () => { clock.advance(6000, false); return pass } }, 'owner', 1, '昵称'), { code: 'MODERATION_UNAVAILABLE' })
  assert.equal(clock.pending(), 0)
})

test('a rejected segment stops remaining work without retrying the provider', async () => {
  const clock = clockFixture(), resolvers = []
  const operation = moderateText({ clock, check: () => new Promise(resolve => resolvers.push(resolve)) }, 'owner', 3, '文'.repeat(10000))
  const rejected = assert.rejects(operation, { code: 'CONTENT_REJECTED' })
  resolvers[0]({ errcode: 0, result: { suggest: 'review' } })
  await rejected
  resolvers[1](pass)
  await flush()
  assert.equal(resolvers.length, 2)
  assert.equal(clock.pending(), 0)
})
test('official text checks bind trusted identity and inspect every overlapping Unicode segment', async () => {
  const content = '学校🌱'.repeat(2500), seen = []
  const result = await moderateText({ check: async input => { seen.push(input); return { errcode: 0, result: { suggest: 'pass' } } } }, 'trusted', 3, content)
  assert.equal(result.clean, true); assert.ok(seen.length > 1)
  for (const request of seen) {
    assert.equal(request.openid, 'trusted'); assert.equal(request.scene, 3); assert.equal(request.version, 2)
    assert.ok(request.content.length <= 2500)
    assert.equal(request.content.includes('\uFFFD'), false)
  }
  assert.ok(seen.at(-1).content.endsWith('学校🌱'))
})
test('review, risky, malformed, permission and network failures cannot commit content', async () => {
  const check = response => moderateText({ check: async () => response }, 'owner', 2, '评论')
  await assert.rejects(check({ errcode: 0, result: { suggest: 'review' } }), { code: 'CONTENT_REJECTED' })
  await assert.rejects(check({ errcode: 0, result: { suggest: 'risky' } }), { code: 'CONTENT_REJECTED' })
  for (const response of [null, {}, { errcode: 0 }, { errcode: 48001, result: { suggest: 'pass' } }, { errcode: 0, result: { suggest: 'unknown' } }]) {
    await assert.rejects(check(response), { code: 'MODERATION_UNAVAILABLE' })
  }
  await assert.rejects(moderateText({ check: async () => { throw Error('secret provider error') } }, 'owner', 1, '昵称'), { code: 'MODERATION_UNAVAILABLE' })
  assert.equal((await wechatTextSafety(async () => ({ errCode: 0, result: { suggest: 'pass' } }), 'owner', 1)('名字')).clean, true)
})
