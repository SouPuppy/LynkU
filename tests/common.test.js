const assert = require('node:assert/strict')
const test = require('node:test')

const {
  validateInput,
  stableDocumentId,
  nextNonnegativeCount,
  outboxRetryDelayMs,
  claimOutboxEvent,
  publishedCategoryDeltas,
  checkRateLimit,
  ACTION_ACCESS,
  authorizeAction,
  authorSnapshot,
  withAuth,
  finishOutboxEvent,
  outboxCandidates,
  withScheduledDrain,
} = require('../apps/cloudfunctions/common')

test('validateInput normalizes required and optional text', () => {
  assert.equal(validateInput('   ', { minLen: 1 }).valid, false)
  assert.deepEqual(validateInput('  hello  ', { minLen: 1, maxLen: 5 }), {
    valid: true,
    value: 'hello',
  })
  assert.deepEqual(validateInput('   ', { allowEmpty: true, maxLen: 5 }), {
    valid: true,
    value: '',
  })
  assert.equal(validateInput('123456', { maxLen: 5 }).valid, false)
})

test('stableDocumentId scopes idempotency keys to the sender', () => {
  const first = stableDocumentId('sender-a', 'message-1')
  assert.equal(first, stableDocumentId('sender-a', 'message-1'))
  assert.notEqual(first, stableDocumentId('sender-b', 'message-1'))
  assert.match(first, /^[a-f0-9]{64}$/)
})

test('principal snapshots carry a validated version and omit private permissions', () => {
  assert.deepEqual(authorSnapshot({ _openid: 'alice', nickname: 'Alice', avatar_url: '/alice.png',
    profile_version: 2, email: 'fixture@example.edu', verified: true, role: 'admin' }, 'alice'), {
    _openid: 'alice', nickname: 'Alice', avatar_url: '/alice.png', profile_version: 2,
  })
  for (const user of [null, {}, { profile_version: '2' }, { profile_version: -1 }]) assert.throws(() => authorSnapshot(user, 'alice'))
})

test('published category transitions cover create, moderation, move, and delete', () => {
  assert.deepEqual(publishedCategoryDeltas(null, null, 'published', 'a'), [
    { categoryId: 'a', delta: 1 },
  ])
  assert.deepEqual(publishedCategoryDeltas('published', 'a', 'flagged', 'a'), [
    { categoryId: 'a', delta: -1 },
  ])
  assert.deepEqual(publishedCategoryDeltas('flagged', 'a', 'published', 'a'), [
    { categoryId: 'a', delta: 1 },
  ])
  assert.deepEqual(publishedCategoryDeltas('published', 'a', 'published', 'b'), [
    { categoryId: 'a', delta: -1 },
    { categoryId: 'b', delta: 1 },
  ])
  assert.deepEqual(publishedCategoryDeltas('flagged', 'a', 'deleted', 'a'), [])
  assert.equal(nextNonnegativeCount(0, -1), 0)
  assert.equal(nextNonnegativeCount(3, -1), 2)
})

test('rate limit persists a fixed-window count', async () => {
  const records = new Map()
  const database = {
    runTransaction: async callback => callback({
      collection: () => ({
        doc: key => ({
          get: async () => {
            if (!records.has(key)) return { data: null }
            return { data: records.get(key) }
          },
          set: async ({ data }) => records.set(key, data),
          update: async ({ data }) => records.set(key, { ...records.get(key), ...data }),
        }),
      }),
    }),
  }

  assert.equal((await checkRateLimit(database, 'user', 'send', { limit: 2 })).allowed, true)
  assert.equal((await checkRateLimit(database, 'user', 'send', { limit: 2 })).allowed, true)
  assert.equal((await checkRateLimit(database, 'user', 'send', { limit: 2 })).allowed, false)
  assert.equal((await checkRateLimit(database, 'other', 'send', { limit: 2 })).allowed, true)
})

test('rate limit storage failure blocks write amplification', async () => {
  const database = {
    runTransaction: async () => {
      throw new Error('rate_limits collection unavailable')
    },
  }

  const result = await checkRateLimit(database, 'user', 'posts:create', { limit: 1 })
  assert.equal(result.allowed, false)
  assert.equal(result.unavailable, true)
})

test('rate lookup errors and corrupt windows never reset or bypass the limit', async () => {
  const now = Date.now()
  const valid = { _openid: 'user', action: 'send', count: 2, window_start: now }
  const responses = [undefined, {}, { data: [] }, { data: { ...valid, count: '2' } },
    { data: { ...valid, count: -1 } }, { data: { ...valid, window_start: now + 3600000 } },
    { data: { ...valid, _openid: 'other' } }, { data: { ...valid, action: 'other' } },
    Object.assign(new Error('database failure'), { errCode: -1 })]
  for (const response of responses) {
    let writes = 0
    const db = { runTransaction: work => work({ collection: () => ({ doc: () => ({
      get: async () => { if (response instanceof Error) throw response; return response },
      set: async () => { writes++ }, update: async () => { writes++ },
    }) }) }) }
    const result = await checkRateLimit(db, 'user', 'send', { limit: 2 })
    assert.equal(result.allowed, false); assert.equal(result.unavailable, true)
    assert.equal(writes, 0)
  }
})

test('outbox claims respect active leases and use bounded exponential retry delays', async () => {
  const records = new Map([['event-1', { status: 'pending', attempt_count: 0, next_attempt_at: 0 }]])
  const database = {
    runTransaction: async callback => callback({
      collection: () => ({
        doc: id => ({
          get: async () => ({ data: records.get(id) }),
          update: async ({ data }) => records.set(id, { ...records.get(id), ...data }),
        }),
      }),
    }),
  }
  const first = await claimOutboxEvent(database, 'outbox', 'event-1', 100)
  assert.equal(first.attemptCount, 1)
  assert.equal(records.get('event-1').status, 'processing')
  assert.equal(await claimOutboxEvent(database, 'outbox', 'event-1', 101), null)
  assert.equal(outboxRetryDelayMs(1), 2000)
  assert.equal(outboxRetryDelayMs(100), 3600000)
})

test('action policy rejects unknown actions and applies server-owned account state', async () => {
  const user = { _openid: 'user', verified: false, role: 'user' }
  const database = {
    collection: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ data: [user] }) }) }),
    }),
  }
  assert.equal(ACTION_ACCESS.messages.listConversations, 'verified')
  assert.equal((await authorizeAction(database, 'user', 'messages', 'listConversations')).response.code, 'EMAIL_NOT_VERIFIED')
  assert.equal((await authorizeAction(database, 'user', 'messages', 'madeUp')).response.code, 'UNKNOWN_ACTION')
  assert.equal((await authorizeAction(database, 'user', 'posts', 'list')).allowed, true)
  for (const bad of ['true', 'false', 1, {}, null]) {
    user.verified = bad
    assert.equal((await authorizeAction(database, 'user', 'drafts', 'list')).allowed, false)
  }
  user.verified = true
  assert.equal((await authorizeAction(database, 'user', 'drafts', 'list')).allowed, true)
  user.role = 'admin'
  assert.equal((await authorizeAction(database, 'user', 'categories', 'create')).allowed, true)
})

test('cloud boundary rejects malformed events and suppresses internal exception details', async () => {
  let calls = 0
  const handler = withAuth({ getWXContext: () => ({ OPENID: 'trusted' }) }, async () => {
    calls++; throw new Error('private database request credentials')
  })
  for (const bad of [undefined, null, [], 'action', {}, { action: 1 }]) assert.equal((await handler(bad)).code, 'INVALID_INPUT')
  assert.equal(calls, 0)
  const response = await handler({ action: 'valid', openid: 'forged' })
  assert.equal(response.code, 'OPERATION_ERROR')
  assert.equal(JSON.stringify(response).includes('private'), false)
})

test('expired outbox work is reclaimed and late completions cannot overwrite a newer lease', async () => {
  const records = new Map([['event', { status: 'pending', attempt_count: 0, next_attempt_at: 0 }]])
  const db = { serverDate: () => new Date(), runTransaction: async work => work({ collection: () => ({ doc: id => ({
    get: async () => ({ data: records.get(id) }),
    update: async ({ data }) => records.set(id, { ...records.get(id), ...data }),
  }) }) }) }
  const first = await claimOutboxEvent(db, 'outbox', 'event', 0)
  assert.equal(await claimOutboxEvent(db, 'outbox', 'event', 29999), null)
  const second = await claimOutboxEvent(db, 'outbox', 'event', 30000)
  assert.equal(second.attemptCount, 2)
  assert.equal(await finishOutboxEvent(db, 'outbox', 'event', first.attemptCount, true), false)
  assert.equal(await finishOutboxEvent(db, 'outbox', 'event', second.attemptCount, true), true)
  assert.equal(await finishOutboxEvent(db, 'outbox', 'event', first.attemptCount, false), false)
  assert.equal(records.get('event').status, 'delivered')
})

test('outbox candidate reads reserve bounded capacity for due retries and expired leases', async () => {
  const seen = []
  const db = { command: { lte: value => ({ lte: value }) }, collection: () => ({ where: filter => ({
    orderBy: (field, direction) => ({ limit: take => ({ get: async () => {
      seen.push({ filter, field, direction, take }); return { data: [{ _id: filter.status }] }
    } }) }),
  }) }) }
  assert.deepEqual(await outboxCandidates(db, 'outbox', 100), ['pending', 'processing'])
  assert.equal(seen[0].filter.next_attempt_at.lte, 100)
  assert.equal(seen[1].filter.lease_until.lte, 100)
  assert.equal(seen[0].take + seen[1].take, 50)
})

test('scheduled adapter rejects forged client timers and reports failed delivery to the platform', async () => {
  const before = process.env.TRIGGER_SRC
  let openid, drained = 0, failed = 0
  const main = withScheduledDrain({ getWXContext: () => ({ OPENID: openid }) }, async () => ({ denied: true }),
    'profile-outbox', async () => { drained++; return { data: { attempted: 1, delivered: 0, failed } } })
  const event = { Type: 'Timer', TriggerName: 'profile-outbox' }
  try {
    delete process.env.TRIGGER_SRC
    assert.equal((await main(event)).denied, true)
    process.env.TRIGGER_SRC = 'timer'; openid = 'client'
    assert.equal((await main(event)).denied, true)
    assert.equal(drained, 0)
    openid = undefined
    assert.equal((await main(event)).data.attempted, 1)
    failed = 1
    await assert.rejects(main(event), /OUTBOX_DELIVERY_FAILED/)
  } finally {
    if (before === undefined) delete process.env.TRIGGER_SRC
    else process.env.TRIGGER_SRC = before
  }
})

test('account lookup failures do not become an unauthenticated result', async () => {
  const database = {
    collection: () => ({
      where: () => ({ limit: () => ({ get: async () => { throw new Error('database offline') } }) }),
    }),
  }
  const result = await authorizeAction(database, 'user', 'messages', 'listConversations')
  assert.equal(result.allowed, false)
  assert.equal(result.response.code, 'AUTH_UNAVAILABLE')
})
