// Transitional server helpers. This is the only source; esbuild includes it in
// each standalone upload bundle. Cloud entries import ../common directly.

const crypto = require('crypto')
const { nextOutboxLease, ownsOutboxLease, isScheduledDrain } = require('@lucky/server')

// ── Response envelopes ──

function ok(data) { return { data } }
function fail(error, code) { return { error, code: code || 'UNKNOWN' } }

// ── Action access policy ──
// All CloudBase invocations have a runtime OPENID. "account" additionally
// requires an application account, while "verified" and "admin" add their
// corresponding server-owned account state.

const ACTION_ACCESS = Object.freeze({
  users: Object.freeze({
    ensure: 'runtime', updateProfile: 'account', getProfile: 'account', drainProfileOutbox: 'admin',
    // The paused-service response must win before any account/database lookup.
    sendEmailCode: 'runtime', verifyEmailCode: 'runtime',
  }),
  posts: Object.freeze({
    list: 'runtime', get: 'runtime', search: 'runtime', create: 'verified',
    update: 'verified', delete: 'account', flag: 'admin', listMine: 'verified',
  }),
  comments: Object.freeze({ list: 'runtime', syncChanges: 'runtime', create: 'verified', delete: 'account', drainOutbox: 'admin' }),
  messages: Object.freeze({
    getUnreadMessageCount: 'verified',
    getReadReceipts: 'verified',
    send: 'verified', listConversations: 'verified', getConversation: 'verified',
    syncConversation: 'verified', markRead: 'verified', listNotifications: 'verified',
    getUnreadNotificationCount: 'verified', markNotificationsRead: 'verified',
  }),
  categories: Object.freeze({ list: 'runtime', seed: 'admin', create: 'admin', update: 'admin' }),
  drafts: Object.freeze({ save: 'verified', list: 'verified', delete: 'verified' }),
})

async function authorizeAction(db, openid, functionName, action) {
  const access = ACTION_ACCESS[functionName] && ACTION_ACCESS[functionName][action]
  if (!access) return { allowed: false, response: fail('未知操作', 'UNKNOWN_ACTION') }
  if (access === 'runtime') return { allowed: true }

  let user
  try {
    user = await findUserByOpenid(db, openid)
  } catch (error) {
    console.error('[auth] account lookup failed:', error.message || error)
    return { allowed: false, response: fail('身份服务暂时不可用', 'AUTH_UNAVAILABLE') }
  }
  if (!user) return { allowed: false, response: fail('请先登录', 'AUTH_FAILED') }
  if (access === 'account') return { allowed: true, user }
  if (access === 'verified') {
    return user.verified === true
      ? { allowed: true, user }
      : { allowed: false, response: fail('请先完成 Nottingham 邮箱认证', 'EMAIL_NOT_VERIFIED') }
  }
  return user.role === 'admin'
    ? { allowed: true, user }
    : { allowed: false, response: fail('需要管理员权限', 'FORBIDDEN') }
}

// ── Input validation ──

function validateInput(value, rules = {}) {
  if (typeof value !== 'string') return { valid: false, error: '输入格式不正确' }
  const normalized = rules.trim === false ? value : value.trim()
  if (!rules.allowEmpty && normalized.length === 0) return { valid: false, error: '输入不能为空' }
  if (rules.minLen && normalized.length < rules.minLen) return { valid: false, error: `最少需要 ${rules.minLen} 个字符` }
  if (rules.maxLen && normalized.length > rules.maxLen) return { valid: false, error: `最多允许 ${rules.maxLen} 个字符` }
  return { valid: true, value: normalized }
}

function stableDocumentId(...parts) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex')
}

function nextNonnegativeCount(current, delta) {
  return Math.max(0, Number(current || 0) + Number(delta || 0))
}

function outboxRetryDelayMs(attemptCount) {
  return Math.min(3600000, 1000 * (2 ** Math.min(Number(attemptCount || 0), 16)))
}

async function claimOutboxEvent(db, collectionName, id, now = Date.now()) {
  return db.runTransaction(async transaction => {
    const ref = transaction.collection(collectionName).doc(id)
    const result = await ref.get()
    const event = result.data
    const lease = nextOutboxLease(event, now)
    if (!lease) return null
    const { attemptCount, leaseUntil } = lease
    await ref.update({ data: {
      status: 'processing',
      attempt_count: attemptCount,
      lease_until: leaseUntil,
      last_attempt_at: now,
    } })
    return { event, attemptCount }
  })
}

async function outboxCandidates(db, name, now = Date.now()) {
  const collection = db.collection(name)
  const _ = db.command
  // Reserve capacity for expired leases: future retries cannot starve crash recovery.
  const [pending, expired] = await Promise.all([
    collection.where({ status: 'pending', next_attempt_at: _.lte(now) }).orderBy('next_attempt_at', 'asc').limit(25).get(),
    collection.where({ status: 'processing', lease_until: _.lte(now) }).orderBy('lease_until', 'asc').limit(25).get(),
  ])
  return [...new Set([...pending.data, ...expired.data].map(event => event._id))]
}

async function finishOutboxEvent(db, name, id, attemptCount, delivered, now = Date.now()) {
  return db.runTransaction(async transaction => {
    const ref = transaction.collection(name).doc(id)
    const current = await ref.get()
    if (!ownsOutboxLease(current.data, attemptCount)) return false
    await ref.update({ data: delivered
      ? { status: 'delivered', lease_until: null, delivered_at: db.serverDate() }
      : { status: 'pending', lease_until: null, next_attempt_at: now + outboxRetryDelayMs(attemptCount), last_error: 'DELIVERY_FAILED' } })
    return true
  })
}

function publishedCategoryDeltas(oldStatus, oldCategoryId, newStatus, newCategoryId) {
  const deltas = []
  const oldPublished = oldStatus === 'published'
  const newPublished = newStatus === 'published'
  if (oldCategoryId && oldPublished && (!newPublished || oldCategoryId !== newCategoryId)) {
    deltas.push({ categoryId: oldCategoryId, delta: -1 })
  }
  if (newCategoryId && newPublished && (!oldPublished || oldCategoryId !== newCategoryId)) {
    deltas.push({ categoryId: newCategoryId, delta: 1 })
  }
  return deltas
}

// ── Sensitive word filter ──

const SENSITIVE_WORDS = [
  // profanity
  'fuck', 'shit', 'damn', 'asshole', 'bastard', 'bitch',
  'sb', 'tmd', 'nmsl', 'cnm', 'ntm', 'woc',
  '傻逼', '操你', '他妈', '妈的', '草泥马', '尼玛',
  '滚蛋', '去死', '废物', '垃圾人',
  // academic dishonesty
  '代写', '代考', '代课', '论文代写', '作业代写',
  // spam/scam
  '办证', '刻章', '发票代开',
  // adult
  '裸聊', '约炮', '一夜情',
]

function filterSensitiveWords(text) {
  const lower = text.toLowerCase()
  const matches = SENSITIVE_WORDS.filter(w => {
    const wLower = w.toLowerCase()
    // ponytail: use word-boundary match for short Latin entries (<=4 chars)
    // to avoid false positives (e.g., 'sb' inside 'adsb'). Chinese entries
    // use substring match (no word boundaries in CJK).
    const isLatin = /^[a-z]+$/i.test(w)
    if (isLatin && w.length <= 4) {
      const re = new RegExp('\\b' + wLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
      return re.test(lower)
    }
    return lower.includes(wLower)
  })
  return { clean: matches.length === 0, matches }
}

// ── Authorization ──

async function findUserByOpenid(db, openid) {
  if (!openid) return null
  const result = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get()
  return result.data[0] || null
}

async function getUserByOpenid(db, openid) {
  try {
    return await findUserByOpenid(db, openid)
  } catch (_) {
    return null
  }
}

async function checkAdmin(db, openid) {
  const user = await getUserByOpenid(db, openid)
  return !!(user && user.role === 'admin')
}

// ── Author snapshot (denormalized into posts/comments/messages) ──

function authorSnapshot(user, openid) {
  if (!Number.isSafeInteger(user?.profile_version) || user.profile_version < 0) throw new Error('Invalid author profile version')
  return {
    profile_version: user.profile_version,
    _openid: typeof user?._openid === 'string' && user._openid ? user._openid : openid,
    nickname: typeof user?.nickname === 'string' && user.nickname ? user.nickname : '用户',
    avatar_url: typeof user?.avatar_url === 'string' ? user.avatar_url : '',
  }
}

// ── Persistent fixed-window rate limiting ──

async function checkRateLimit(db, openid, action, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 10)
  const windowMs = Math.max(1000, Number(options.windowMs) || 3600000)
  const now = Date.now()
  const key = crypto
    .createHash('sha256')
    .update(`${action}\0${openid}`)
    .digest('hex')

  try {
    return await db.runTransaction(async transaction => {
      const ref = transaction.collection('rate_limits').doc(key)
      let record = null
      try {
        const result = await ref.get()
        record = result.data || null
      } catch (error) {
        if (error.errCode !== -1) throw error
      }

      if (!record || now - Number(record.window_start || 0) >= windowMs) {
        await ref.set({
          data: {
            _openid: openid,
            action,
            count: 1,
            window_start: now,
            updated_at: new Date(now),
          },
        })
        return { allowed: true, remaining: limit - 1 }
      }

      if (record.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil((record.window_start + windowMs - now) / 1000)),
        }
      }

      await ref.update({
        data: {
          count: Number(record.count || 0) + 1,
          updated_at: new Date(now),
        },
      })
      return { allowed: true, remaining: limit - Number(record.count || 0) - 1 }
    })
  } catch (error) {
    console.error('[rate-limit] persistence failed:', action, error.message || error)
    return { allowed: false, unavailable: true, remaining: 0 }
  }
}

// ── Auth middleware wrapper ──

function withAuth(cloud, handler) {
  return async function(event, context) {
    const openid = cloud.getWXContext().OPENID
    if (!openid) return fail('身份验证失败', 'AUTH_FAILED')
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || typeof event.action !== 'string' || event.action.length > 64) return fail('请求格式无效', 'INVALID_INPUT')
    try { return await handler(openid, event, context) } catch (_) {
      console.error('[cloud] unhandled operation failure')
      return fail('服务暂时不可用，请稍后重试', 'OPERATION_ERROR')
    }
  }
}

function withScheduledDrain(cloud, authenticated, triggerName, drain) {
  return async (event, context) => {
    if (!isScheduledDrain(process.env.TRIGGER_SRC, cloud.getWXContext().OPENID, event, triggerName)) {
      return authenticated(event, context)
    }
    // Throw on infrastructure failure so the platform records a failed invocation.
    const result = await drain()
    console.log(JSON.stringify({ event: 'outbox_drain', trigger: triggerName, ...result.data }))
    if (result.data.failed > 0) throw new Error('OUTBOX_DELIVERY_FAILED')
    return result
  }
}

module.exports = {
  ok,
  fail,
  ACTION_ACCESS,
  authorizeAction,
  validateInput,
  stableDocumentId,
  nextNonnegativeCount,
  outboxRetryDelayMs,
  claimOutboxEvent,
  outboxCandidates,
  finishOutboxEvent,
  publishedCategoryDeltas,
  filterSensitiveWords,
  findUserByOpenid,
  getUserByOpenid,
  checkAdmin,
  authorSnapshot,
  checkRateLimit,
  withAuth,
  withScheduledDrain,
}
