// cloud function: users — User collection owner (ensure + updateProfile + denormalized sync)
import * as cloud from 'wx-server-sdk'
import { wechatTextSafety, cloudbaseProfileProjection } from '@lynku/adapters'
import { ModerationFailure } from '@lynku/server'
import { acceptAgreement, AgreementFailure, type AgreementStore } from '@lynku/server'
import { connectDatabase, CLOUD_DATABASE_OPTIONS, text, type Row } from '../common/database'
import { legalManifest } from '../common/generated/legal-manifest'
import * as crypto from 'crypto'
import * as https from 'https'
cloud.init()
const rawDb = cloud.database(CLOUD_DATABASE_OPTIONS)
const db = connectDatabase(rawDb)
const _ = db.command
import { ok, fail, stableDocumentId, claimOutboxEvent, outboxCandidates, finishOutboxEvent, findUserByOpenid, authorizeAction, withAuth, withScheduledDrain } from '../common'
import { ensureAccount, updateAccountProfile, ProfileUpdateFailure, projectAccountProfile, verificationMail, parseMailAcceptance, confirmSchoolEmail, EmailVerificationFailure, sendSchoolVerification, VerificationSendFailure,
  type NewAccount, type VerificationSendStore, type EmailVerificationStore, type ProfileUpdateStore } from '@lynku/server'
import { readPublicProfile, PublicProfileFailure } from '@lynku/server'

const MAILGUN_TIMEOUT_MS = 8000

const authenticated = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'users', event.action)
  if (!authorization.allowed) return authorization.response
  if (['sendEmailCode', 'verifyEmailCode'].includes(event.action)
      && process.env.EMAIL_VERIFICATION_ENABLED !== 'true') {
    return fail('学校邮箱认证暂不可用', 'EMAIL_VERIFICATION_UNAVAILABLE')
  }
  switch (event.action) {
    case 'acceptAgreement': return recordAgreement(openid, event, authorization.user)
    case 'ensure': return ensureUser(openid, event)
    case 'updateProfile': return updateProfile(openid, event)
    case 'getProfile': return getPublicProfile(event.openid)
    case 'drainProfileOutbox': return drainProfileOutbox(undefined)
    case 'sendEmailCode': return sendEmailCode(openid, event)
    case 'verifyEmailCode': return verifyEmailCode(openid, event)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})
export const main = withScheduledDrain(cloud, authenticated, 'profile-outbox', () => drainProfileOutbox(undefined))

async function recordAgreement(openid: string, event: unknown, principal: Row | undefined) {
  try {
    if (!principal || principal._openid !== openid) return fail('身份服务暂时不可用', 'AUTH_UNAVAILABLE')
    const accountId = text(principal._id)
    const database = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
    const rows = (await database.collection('account_lifecycle').where({ currentAccountId: accountId }).limit(2).get()).data
    if (rows.length !== 1) return fail('账号保护状态暂不可用，请稍后重试', 'AUTH_UNAVAILABLE')
    const lifecycleId = text(rows[0]?._id)
    const store: AgreementStore = {
      identifier: stableDocumentId, now: () => new Date().toISOString(),
      run: work => database.runTransaction(tx => work({
        lifecycle: async () => (await tx.collection('account_lifecycle').doc(lifecycleId).get()).data,
        assent: async id => (await tx.collection('agreement_assents').doc(id).get()).data,
        put: (id, data) => tx.collection('agreement_assents').doc(id).set({ data }),
        touchLifecycle: (id, writeFence) => tx.collection('account_lifecycle').doc(id).update({ data: { writeFence } }),
      })),
    }
    return ok(await acceptAgreement(store, legalManifest, accountId, event))
  } catch (error) {
    return fail('协议确认未完成，请保留当前页面后重试', error instanceof AgreementFailure ? error.code : 'AUTH_UNAVAILABLE')
  }
}

// Account lookup errors must never become first-time registration.
async function ensureUser(openid: string, event: Row) {
  if (event.nickname !== undefined || event.avatar_url !== undefined) return fail('请通过资料修改接口更新资料', 'INVALID_INPUT')
  const identityDb = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
  const store = {
    find: (owner: string) => findUserByOpenid(db, owner),
    identifier: (owner: string) => stableDocumentId('account', owner),
    now: () => new Date().toISOString(),
    createIfAbsent: (account: NewAccount) => identityDb.runTransaction(async transaction => {
      const document = transaction.collection('users').doc(account._id)
      const existing = await document.get()
      if (existing.data !== null) return existing.data
      const { _id, ...fields } = account
      const next = { ...fields, created_at: new Date(text(fields.created_at)), updated_at: new Date(text(fields.updated_at)) }
      await document.set({ data: next })
      return { _id, ...next }
    }),
  }
  try { return ok({ user: await ensureAccount(store, openid) }) } catch (_) {
    return fail('微信账号暂时无法获取，请重试', 'QUERY_ERROR')
  }
}

function hashCode(openid: string, email: string, code: string) {
  const secret = process.env.MAILGUN_API_KEY
  if (!secret) throw new Error('Mail service credential unavailable')
  return crypto.createHash('sha256').update(`${openid}\0${email}\0${code}\0${secret}`).digest('hex')
}

function verificationDocId(openid: string, _email = '') {
  return crypto.createHash('sha256').update(`email_verification\0${openid}`).digest('hex')
}

function createCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

async function assertEmailAvailable(email: string, openid: string) {
  const result = await db.collection('users')
    .where({ email, verified: true, _openid: _.neq(openid) })
    .limit(1)
    .get()
  return result.data.length === 0
}

async function sendMailgunCode(email: string, code: string) {
  const key = process.env.MAILGUN_API_KEY
  if (!key) throw new Error('MAILGUN_API_KEY missing')

  const mail = verificationMail(email, code)
  const boundary = '----verification-' + crypto.randomBytes(12).toString('hex')
  const body = multipartBody(boundary, { from: mail.from, to: mail.to, subject: mail.subject, text: mail.text })
  return requestMailgun('/v3/' + mail.domain + '/messages', boundary, body, key)
}

function multipartBody(boundary: string, fields: Record<string, string>) {
  const lines: string[] = []
  for (const [name, value] of Object.entries(fields)) {
    lines.push(`--${boundary}`)
    lines.push(`Content-Disposition: form-data; name="${name}"`)
    lines.push('')
    lines.push(String(value))
  }
  lines.push(`--${boundary}--`)
  lines.push('')
  return Buffer.from(lines.join('\r\n'), 'utf8')
}

function requestMailgun(path: string, boundary: string, body: Buffer, key: string): Promise<unknown> {
  return new Promise((resolve, reject: (error: Error) => void) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.mailgun.net',
      path,
      timeout: MAILGUN_TIMEOUT_MS,
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${key}`).toString('base64')}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 65536) { res.destroy(); reject(new Error('Mailgun response too large')); return }
        chunks.push(chunk)
      })
      res.on('error', () => reject(new Error('Mailgun response interrupted')))
      res.on('aborted', () => reject(new Error('Mailgun response interrupted')))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(parseMailAcceptance(JSON.parse(text))) } catch (_) { reject(new Error('Mailgun acceptance could not be confirmed')) }
          return
        }
        reject(new Error('Mailgun request rejected'))
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('Mailgun request timed out'))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function sendEmailCode(openid: string, event: unknown) {
  const verificationDb = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
  const store: VerificationSendStore = {
    findUser: (owner: string) => findUserByOpenid(db, owner), emailAvailable: assertEmailAvailable,
    identifier: verificationDocId, code: createCode, generation: () => crypto.randomBytes(16).toString('hex'),
    hash: hashCode, now: () => Date.now(), send: sendMailgunCode,
    run: <T>(work: Parameters<VerificationSendStore['run']>[0]) => verificationDb.runTransaction<T>(transaction => (work as unknown as ((tx: {
      get(name: 'users' | 'email_verifications' | 'email_send_limits', id: string): Promise<unknown | null>
      put(name: 'users' | 'email_verifications' | 'email_send_limits', id: string, fields: Row): Promise<void>
      update(name: 'users' | 'email_verifications' | 'email_send_limits', id: string, fields: Row): Promise<void>
    }) => Promise<T>))({
      get: async (name: string, id: string) => (await transaction.collection(name).doc(id).get()).data,
      put: (name: string, id: string, fields: Row) => transaction.collection(name).doc(id).set({ data: fields }),
      update: (name: string, id: string, fields: Row) => transaction.collection(name).doc(id).update({ data: fields }),
    })),
  }
  try { return ok(await sendSchoolVerification(store, openid, event)) } catch (error) {
    return fail('验证码发送未完成，请稍后重试', error instanceof VerificationSendFailure || error instanceof EmailVerificationFailure ? error.code : 'SAVE_ERROR')
  }
}

async function verifyEmailCode(openid: string, event: unknown) {
  const verificationDb = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
  const store: EmailVerificationStore = {
    findUser: (owner: string) => findUserByOpenid(db, owner),
    emailAvailable: assertEmailAvailable,
    challengeId: verificationDocId,
    claimId: (email: string) => stableDocumentId('email:claim', email),
    hash: hashCode,
    now: () => Date.now(),
    run: <T>(work: Parameters<EmailVerificationStore['run']>[0]) => verificationDb.runTransaction<T>(transaction => (work as unknown as ((tx: {
      get(name: 'users' | 'email_verifications' | 'email_claims', id: string): Promise<unknown | null>
      put(name: 'users' | 'email_verifications' | 'email_claims', id: string, fields: Row): Promise<void>
      update(name: 'users' | 'email_verifications' | 'email_claims', id: string, fields: Row): Promise<void>
      remove(name: 'users' | 'email_verifications' | 'email_claims', id: string): Promise<void>
    }) => Promise<T>))({
      get: async (name: string, id: string) => (await transaction.collection(name).doc(id).get()).data,
      update: (name: string, id: string, fields: Row) => transaction.collection(name).doc(id).update({ data: fields }),
      put: (name: string, id: string, fields: Row) => transaction.collection(name).doc(id).set({ data: fields }),
      remove: (name: string, id: string) => transaction.collection(name).doc(id).remove(),
    })),
  }
  try { return ok({ user: await confirmSchoolEmail(store, openid, event) }) } catch (error) {
    return fail('邮箱认证未完成，请重试', error instanceof EmailVerificationFailure ? error.code : 'VERIFY_ERROR')
  }
}

// ── updateProfile — Update nickname/avatar with validation + denormalized sync ──

async function updateProfile(openid: string, event: unknown) {
  const profileDb = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
  const store: ProfileUpdateStore = {
    find: (owner: string) => findUserByOpenid(db, owner),
    identifier: (owner: string, version: number) => stableDocumentId('profile:projection', owner, String(version)),
    moderate: wechatTextSafety(input => cloud.openapi.security.msgSecCheck(input), openid, 1),
    now: () => new Date().toISOString(),
    run: <T>(work: Parameters<ProfileUpdateStore['run']>[0]) => profileDb.runTransaction<T>(transaction => (work as unknown as ((tx: {
      read(id: string): Promise<unknown | null>
      update(id: string, fields: { profile_version: number; updated_at: string; nickname?: string; avatar_url?: string }): Promise<void>
      enqueue(id: string, fields: { openid: string; profile_version: number; status: 'pending'; attempt_count: 0; next_attempt_at: number; created_at: string }): Promise<void>
    }) => Promise<T>))({
      read: async (id: string) => (await transaction.collection('users').doc(id).get()).data,
      update: (id: string, fields) => transaction.collection('users').doc(id).update({ data: { ...fields, updated_at: new Date(text(fields.updated_at)) } }),
      enqueue: (id: string, fields) => transaction.collection('profile_outbox').doc(id).set({ data: { ...fields, created_at: new Date(text(fields.created_at)) } }),
    })),
  }
  try {
    const result = await updateAccountProfile(store, openid, event)
    if (result.outboxId) {
      try { await drainProfileOutbox([result.outboxId]) } catch (_) { console.warn('[users] profile projection deferred') }
    }
    return ok({ user: result.user })
  } catch (error) {
    if (error instanceof ModerationFailure) return fail(error.code === 'CONTENT_REJECTED' ? '昵称未通过审核' : '审核服务暂不可用，请稍后重试', error.code)
    return fail('更新失败', error instanceof ProfileUpdateFailure ? error.code : 'UPDATE_ERROR')
  }
}

// ── Profile projection outbox — owns denormalized author snapshots ──

async function drainProfileOutbox(ids: string[] | undefined) {
  const candidates = Array.isArray(ids) ? ids : await outboxCandidates(db, 'profile_outbox')
  const results = await Promise.allSettled(candidates.map(async id => {
    const claimed = await claimOutboxEvent(db, 'profile_outbox', id)
    if (!claimed) return false
    try {
      const sourceOpenid = text(claimed.event.openid)
      const user = await findUserByOpenid(db, sourceOpenid)
      if (!user) throw new Error('Profile source is unavailable')
      await projectAccountProfile(cloudbaseProfileProjection(rawDb), sourceOpenid, user)
      return await finishOutboxEvent(db, 'profile_outbox', id, claimed.attemptCount, true)
    } catch (error) {
      await finishOutboxEvent(db, 'profile_outbox', id, claimed.attemptCount, false)
      throw error
    }
  }))
  for (const result of results) {
    if (result.status === 'rejected') console.error('[users] profile projection deferred')
  }
  return ok({ attempted: candidates.length, delivered: results.filter(result => result.status === 'fulfilled' && result.value).length,
    failed: results.filter(result => result.status === 'rejected').length })
}

// ── getPublicProfile — Read any user's public fields (bypasses client ACL) ──

async function getPublicProfile(targetOpenid: unknown) {
  try {
    return ok({ profile: await readPublicProfile(id => findUserByOpenid(db, id), targetOpenid) })
  } catch (e) {
    return fail('查询失败', e instanceof PublicProfileFailure ? e.code : 'QUERY_ERROR')
  }
}
