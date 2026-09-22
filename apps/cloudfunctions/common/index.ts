// Transitional server helpers. This is the only source; esbuild includes it in
// each standalone upload bundle. Cloud entries import ../common directly.

import * as crypto from 'crypto'
import { assertAccountCapability, AccountRestrictionFailure } from '@lynku/server'
import { nextOutboxLease, ownsOutboxLease, isScheduledDrain } from '@lynku/server'
import { record, type Row } from './database'

interface AccountLookup {
  collection(name: string): { where(condition: object): { limit(take: number): { get(): unknown } } }
}
export type CloudEvent = Row & { action: string }
interface RuntimeIdentity { getWXContext(): { OPENID?: unknown } }
type Authorization = { allowed: true; user?: Row } | { allowed: false; response: ReturnType<typeof fail> }
interface StoredDocument {
  get(): unknown
  set(options: { data: Row }): unknown
  update(options: { data: Row }): unknown
}
interface TransactionDatabase {
  runTransaction<T>(work: (tx: { collection(name: string): { doc(id: string): StoredDocument } }) => Promise<T>): Promise<T>
}
interface OutboxQuery {
  where(condition: object): OutboxQuery
  orderBy(field: string, direction: 'asc' | 'desc'): OutboxQuery
  limit(take: number): OutboxQuery
  get(): unknown
}
interface OutboxDatabase extends TransactionDatabase {
  collection(name: string): OutboxQuery
  command: { lte(value: number): unknown }
  serverDate(): unknown
}
function documentData(value: unknown): Row | null {
  const data = record(value).data
  return data === null ? null : record(data)
}

// ── Response envelopes ──

export function ok<T>(data: T) { return { data } }
export function fail(error: string, code = 'UNKNOWN') { return { error, code } }

// ── Action access policy ──
// All CloudBase invocations have a runtime OPENID. "account" additionally
// requires an application account, while "verified" and "admin" add their
// corresponding server-owned account state.

export const ACTION_ACCESS = Object.freeze({
  users: Object.freeze({
    ensure: 'runtime', acceptAgreement: 'account', updateProfile: 'account', getProfile: 'account', drainProfileOutbox: 'admin',
    // The paused-service response must win before any account/database lookup.
    sendEmailCode: 'runtime', verifyEmailCode: 'runtime',
  }),
  posts: Object.freeze({
    list: 'runtime', get: 'runtime', search: 'runtime', create: 'verified',
    update: 'verified', delete: 'account', listMine: 'verified',
  }),
  comments: Object.freeze({ list: 'runtime', syncChanges: 'runtime', create: 'verified', delete: 'account', drainOutbox: 'admin' }),
  messages: Object.freeze({
    getUnreadMessageCount: 'verified',
    getReadReceipts: 'verified',
    send: 'verified', listConversations: 'verified', getConversation: 'verified',
    syncConversation: 'verified', markRead: 'verified', listNotifications: 'verified',
    getUnreadNotificationCount: 'verified', markNotificationsRead: 'verified',
    blockContact: 'verified', unblockContact: 'verified',
  }),
  categories: Object.freeze({ list: 'runtime' }),
  drafts: Object.freeze({ save: 'verified', list: 'verified', delete: 'verified' }),
  governance: Object.freeze({ appealReport: 'account', submitReport: 'account', readReport: 'account', listReports: 'account' }),
  // Web administration uses CloudBase's trusted Web UID and a server-owned
  // admin_members binding. It deliberately cannot pass through withAuth.
  admin: Object.freeze({ restorePost: 'web-admin', readLegalManifest: 'web-admin', readUserProtection: 'web-admin', updateUserProtection: 'web-admin', listMembers: 'web-admin', updateMember: 'web-admin', session: 'web-admin', overview: 'web-admin', listCategories: 'web-admin', updateCategory: 'web-admin', createCategory: 'web-admin', listPosts: 'web-admin', readPost: 'web-admin', listComments: 'web-admin', listUsers: 'web-admin', listCases: 'web-admin', readCase: 'web-admin', readComment: 'web-admin', closeCase: 'web-admin', retryOperation: 'web-admin', listOperationTasks: 'web-admin', readOperationTask: 'web-admin', listOperations: 'web-admin', listAudit: 'web-admin', readAudit: 'web-admin' }),
})

export async function authorizeAction(db: AccountLookup, openid: string, functionName: string, action: unknown): Promise<Authorization> {
  const policies: Readonly<Record<string, Readonly<Record<string, string>>>> = ACTION_ACCESS
  const policy = Object.hasOwn(policies, functionName) ? policies[functionName] : undefined
  const access = policy && typeof action === 'string' && Object.hasOwn(policy, action) ? policy[action] : undefined
  if (!access) return { allowed: false, response: fail('未知操作', 'UNKNOWN_ACTION') }
  if (access === 'runtime') return { allowed: true }

  let user
  try {
    user = await findUserByOpenid(db, openid)
  } catch (_) {
    console.error('[auth] account lookup failed')
    return { allowed: false, response: fail('身份服务暂时不可用', 'AUTH_UNAVAILABLE') }
  }
  if (!user) return { allowed: false, response: fail('请先登录', 'AUTH_FAILED') }
  const capability = functionName === 'posts' && (action === 'create' || action === 'update') ? 'posts'
    : functionName === 'comments' && action === 'create' ? 'comments' : functionName === 'messages' && action === 'send' ? 'messages' : null
  if (capability) {
    try { assertAccountCapability(user, capability, new Date().toISOString()) }
    catch (error) { return { allowed: false, response: fail(error instanceof AccountRestrictionFailure ? error.message : '账号权限暂时无法确认', error instanceof AccountRestrictionFailure ? error.code : 'AUTH_UNAVAILABLE') } }
  }
  if (access === 'account') return { allowed: true, user }
  if (access === 'verified') {
    return user.verified === true
      ? { allowed: true, user }
      : { allowed: false, response: fail('请先完成 Nottingham 邮箱认证', 'EMAIL_NOT_VERIFIED') }
  }
  if (user.verified !== true) return { allowed: false, response: fail('请先完成 Nottingham 邮箱认证', 'EMAIL_NOT_VERIFIED') }
  return user.role === 'admin'
    ? { allowed: true, user }
    : { allowed: false, response: fail('需要管理员权限', 'FORBIDDEN') }
}

// ── Input validation ──

export function validateInput(value: unknown, rules: { trim?: boolean; allowEmpty?: boolean; minLen?: number; maxLen?: number } = {}):
  { valid: true; value: string } | { valid: false; error: string } {
  if (typeof value !== 'string') return { valid: false, error: '输入格式不正确' }
  const normalized = rules.trim === false ? value : value.trim()
  if (!rules.allowEmpty && normalized.length === 0) return { valid: false, error: '输入不能为空' }
  if (rules.minLen && normalized.length < rules.minLen) return { valid: false, error: `最少需要 ${rules.minLen} 个字符` }
  if (rules.maxLen && normalized.length > rules.maxLen) return { valid: false, error: `最多允许 ${rules.maxLen} 个字符` }
  return { valid: true, value: normalized }
}

export function stableDocumentId(...parts: string[]) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex')
}

export function nextNonnegativeCount(current: number, delta: number) {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(delta) || !Number.isSafeInteger(current + delta)) throw Error('Invalid counter')
  return Math.max(0, current + delta)
}

export function outboxRetryDelayMs(attemptCount: number) {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 0) throw Error('Invalid retry count')
  return Math.min(3600000, 1000 * (2 ** Math.min(attemptCount, 16)))
}

export async function claimOutboxEvent(db: TransactionDatabase, collectionName: string, id: string, now = Date.now()) {
  return db.runTransaction(async transaction => {
    const ref = transaction.collection(collectionName).doc(id)
    const result = await ref.get()
    const event = documentData(result)
    if (event === null) return null
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

export async function outboxCandidates(db: OutboxDatabase, name: string, now = Date.now()): Promise<string[]> {
  const collection = db.collection(name)
  const _ = db.command
  // Reserve capacity for expired leases: future retries cannot starve crash recovery.
  const [pending, expired] = await Promise.all([
    collection.where({ status: 'pending', next_attempt_at: _.lte(now) }).orderBy('next_attempt_at', 'asc').limit(25).get(),
    collection.where({ status: 'processing', lease_until: _.lte(now) }).orderBy('lease_until', 'asc').limit(25).get(),
  ])
  const pendingRows = record(pending).data, expiredRows = record(expired).data
  if (!Array.isArray(pendingRows) || !Array.isArray(expiredRows)) throw Error('Invalid outbox query response')
  return [...new Set([...pendingRows, ...expiredRows].map(value => {
    const id = record(value)._id
    if (typeof id !== 'string' || !id) throw Error('Invalid outbox identity')
    return id
  }))]
}

export async function finishOutboxEvent(db: OutboxDatabase, name: string, id: string, attemptCount: number, delivered: boolean, now = Date.now()) {
  return db.runTransaction(async transaction => {
    const ref = transaction.collection(name).doc(id)
    const current = await ref.get()
    if (!ownsOutboxLease(documentData(current), attemptCount)) return false
    await ref.update({ data: delivered
      ? { status: 'delivered', lease_until: null, delivered_at: db.serverDate() }
      : { status: 'pending', lease_until: null, next_attempt_at: now + outboxRetryDelayMs(attemptCount), last_error: 'DELIVERY_FAILED' } })
    return true
  })
}

export function publishedCategoryDeltas(oldStatus: string | null, oldCategoryId: string | null, newStatus: string, newCategoryId: string | null) {
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

// ── Authorization ──

export async function findUserByOpenid(db: AccountLookup, openid: string): Promise<Row | null> {
  if (!openid) return null
  const result = await db.collection('users')
    .where({ _openid: openid })
    .limit(2)
    .get()
  const rows = record(result).data
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('Invalid identity lookup result')
  if (rows.length === 0) return null
  const account = record(rows[0])
  if (account._openid !== openid) throw new Error('Identity lookup owner mismatch')
  return account
}

export async function getUserByOpenid(db: AccountLookup, openid: string) {
  try {
    return await findUserByOpenid(db, openid)
  } catch (_) {
    return null
  }
}

export async function checkAdmin(db: AccountLookup, openid: string) {
  const user = await getUserByOpenid(db, openid)
  return !!(user && user.verified === true && user.role === 'admin')
}

// ── Author snapshot (denormalized into posts/comments/messages) ──

export function authorSnapshot(value: unknown, openid: string) {
  const user = record(value)
  if (typeof user.profile_version !== 'number' || !Number.isSafeInteger(user.profile_version) || user.profile_version < 0) throw new Error('Invalid author profile version')
  return {
    profile_version: user.profile_version,
    _openid: typeof user?._openid === 'string' && user._openid ? user._openid : openid,
    nickname: typeof user?.nickname === 'string' && user.nickname ? user.nickname : '用户',
    avatar_url: typeof user?.avatar_url === 'string' ? user.avatar_url : '',
  }
}

// ── Persistent fixed-window rate limiting ──

export type RateLimitResult = { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; unavailable?: boolean; retryAfter?: number }
export async function checkRateLimit(db: TransactionDatabase, openid: string, action: string, options: { limit?: number; windowMs?: number } = {}): Promise<RateLimitResult> {
  const limit = options.limit ?? 10
  const windowMs = options.windowMs ?? 3600000
  const now = Date.now()
  const key = crypto
    .createHash('sha256')
    .update(`${action}\0${openid}`)
    .digest('hex')

  try {
    if (!openid || !action || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1000) throw Error('Invalid rate policy')
    return await db.runTransaction<RateLimitResult>(async transaction => {
      const ref = transaction.collection('rate_limits').doc(key)
      const current = documentData(await ref.get())
      if (current && (current._openid !== openid || current.action !== action
        || typeof current.count !== 'number' || !Number.isSafeInteger(current.count) || current.count < 0
        || typeof current.window_start !== 'number' || !Number.isSafeInteger(current.window_start) || current.window_start < 0
        || current.window_start > now)) throw Error('Invalid rate record')
      const count = current ? Number(current.count) : 0
      const windowStart = current ? Number(current.window_start) : 0
      if (!current || now - windowStart >= windowMs) {
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

      if (count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
        }
      }

      await ref.update({
        data: {
          count: count + 1,
          updated_at: new Date(now),
        },
      })
      return { allowed: true, remaining: limit - count - 1 }
    })
  } catch (_) {
    console.error('[rate-limit] persistence failed')
    return { allowed: false, unavailable: true, remaining: 0 }
  }
}

// ── Auth middleware wrapper ──

export function withAuth<T>(cloud: RuntimeIdentity, handler: (openid: string, event: CloudEvent, context: unknown) => Promise<T>) {
  return async function(event: unknown, context?: unknown) {
    const openid = cloud.getWXContext().OPENID
    if (typeof openid !== 'string' || !openid || openid.trim() !== openid) return fail('身份验证失败', 'AUTH_FAILED')
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || !('action' in event) || typeof event.action !== 'string' || !event.action || event.action.length > 64) return fail('请求格式无效', 'INVALID_INPUT')
    const input: CloudEvent = { ...record(event), action: event.action }
    try { return await handler(openid, input, context) } catch (_) {
      console.error('[cloud] unhandled operation failure')
      return fail('服务暂时不可用，请稍后重试', 'OPERATION_ERROR')
    }
  }
}

export function withScheduledDrain<T, D extends { failed: number; attempted: number; delivered: number }>(cloud: RuntimeIdentity,
  authenticated: (event: unknown, context?: unknown) => Promise<T>, triggerName: string,
  drain: () => Promise<{ data: D }>) {
  return async (event: unknown, context?: unknown) => {
    if (!isScheduledDrain(process.env.TRIGGER_SRC, cloud.getWXContext().OPENID, event, triggerName)) {
      return authenticated(event, context)
    }
    // Throw on infrastructure failure so the platform records a failed invocation.
    const result = await drain()
    const { attempted, delivered, failed } = result.data
    if (![attempted, delivered, failed].every(value => Number.isSafeInteger(value) && value >= 0)
      || delivered + failed > attempted) throw Error('Invalid drain result')
    console.log(JSON.stringify({ event: 'outbox_drain', trigger: triggerName, attempted, delivered, failed }))
    if (result.data.failed > 0) throw new Error('OUTBOX_DELIVERY_FAILED')
    return result
  }
}
