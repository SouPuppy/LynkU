// cloud function: users — User collection owner (ensure + updateProfile + denormalized sync)
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
cloud.init()
const db = cloud.database()
const _ = db.command
const { ok, fail, validateInput, stableDocumentId, claimOutboxEvent, outboxCandidates, finishOutboxEvent, findUserByOpenid, authorizeAction, withAuth, withScheduledDrain } = require('../common')
const { projectSelfProfile, ensureAccount, updateAccountProfile, ProfileUpdateFailure, profileSnapshot, verificationMail, parseMailAcceptance, confirmSchoolEmail, EmailVerificationFailure, sendSchoolVerification, VerificationSendFailure } = require('@lucky/server')
const { readPublicProfile, PublicProfileFailure } = require('@lucky/server')

const EMAIL_DOMAIN = '@nottingham.edu.cn'
const MAILGUN_TIMEOUT_MS = 8000

const authenticated = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'users', event.action)
  if (!authorization.allowed) return authorization.response
  if (['sendEmailCode', 'verifyEmailCode'].includes(event.action)
      && process.env.EMAIL_VERIFICATION_ENABLED !== 'true') {
    return fail('学校邮箱认证暂不可用', 'EMAIL_VERIFICATION_UNAVAILABLE')
  }
  switch (event.action) {
    case 'ensure': return ensureUser(openid, event)
    case 'updateProfile': return updateProfile(openid, event)
    case 'getProfile': return getPublicProfile(event.openid)
    case 'drainProfileOutbox': return drainProfileOutbox()
    case 'sendEmailCode': return sendEmailCode(openid, event)
    case 'verifyEmailCode': return verifyEmailCode(openid, event)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})
exports.main = withScheduledDrain(cloud, authenticated, 'profile-outbox', () => drainProfileOutbox())

// Account lookup errors must never become first-time registration.
async function ensureUser(openid, event) {
  if (event.nickname !== undefined || event.avatar_url !== undefined) return fail('请通过资料修改接口更新资料', 'INVALID_INPUT')
  const identityDb = cloud.database({ throwOnNotFound: false })
  const store = {
    find: owner => findUserByOpenid(db, owner),
    identifier: owner => stableDocumentId('account', owner),
    now: () => new Date().toISOString(),
    createIfAbsent: account => identityDb.runTransaction(async transaction => {
      const document = transaction.collection('users').doc(account._id)
      const existing = await document.get()
      if (existing.data) return existing.data
      const { _id, ...fields } = account
      const record = { ...fields, created_at: new Date(fields.created_at), updated_at: new Date(fields.updated_at) }
      await document.set({ data: record })
      return { _id, ...record }
    }),
  }
  try { return ok({ user: await ensureAccount(store, openid) }) } catch (_) {
    return fail('微信账号暂时无法获取，请重试', 'QUERY_ERROR')
  }
}

function hashCode(openid, email, code) {
  const secret = process.env.MAILGUN_API_KEY
  if (!secret) throw new Error('Mail service credential unavailable')
  return crypto.createHash('sha256').update(`${openid}\0${email}\0${code}\0${secret}`).digest('hex')
}

function verificationDocId(openid) {
  return crypto.createHash('sha256').update(`email_verification\0${openid}`).digest('hex')
}

function createCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

async function assertEmailAvailable(email, openid) {
  const result = await db.collection('users')
    .where({ email, verified: true, _openid: _.neq(openid) })
    .limit(1)
    .get()
  return result.data.length === 0
}

async function sendMailgunCode(email, code) {
  const key = process.env.MAILGUN_API_KEY
  if (!key) throw new Error('MAILGUN_API_KEY missing')

  const mail = verificationMail(email, code)
  const boundary = '----verification-' + crypto.randomBytes(12).toString('hex')
  const body = multipartBody(boundary, { from: mail.from, to: mail.to, subject: mail.subject, text: mail.text })
  return requestMailgun('/v3/' + mail.domain + '/messages', boundary, body, key)
}

function multipartBody(boundary, fields) {
  const lines = []
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

function requestMailgun(path, boundary, body, key) {
  return new Promise((resolve, reject) => {
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
      const chunks = []
      let size = 0
      res.on('data', chunk => {
        size += chunk.length
        if (size > 65536) { res.destroy(); reject(new Error('Mailgun response too large')); return }
        chunks.push(chunk)
      })
      res.on('error', () => reject(new Error('Mailgun response interrupted')))
      res.on('aborted', () => reject(new Error('Mailgun response interrupted')))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(parseMailAcceptance(JSON.parse(text))) } catch (_) { reject(new Error('Mailgun acceptance could not be confirmed')) }
          return
        }
        const error = new Error('Mailgun request rejected')
        error.statusCode = res.statusCode
        reject(error)
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('Mailgun request timed out'))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function sendEmailCode(openid, event) {
  const verificationDb = cloud.database({ throwOnNotFound: false })
  const store = {
    findUser: owner => findUserByOpenid(db, owner), emailAvailable: assertEmailAvailable,
    identifier: verificationDocId, code: createCode, generation: () => crypto.randomBytes(16).toString('hex'),
    hash: hashCode, now: () => Date.now(), send: sendMailgunCode,
    run: work => verificationDb.runTransaction(transaction => work({
      get: async (name, id) => (await transaction.collection(name).doc(id).get()).data,
      put: (name, id, fields) => transaction.collection(name).doc(id).set({ data: fields }),
      update: (name, id, fields) => transaction.collection(name).doc(id).update({ data: fields }),
    })),
  }
  try { return ok(await sendSchoolVerification(store, openid, event)) } catch (error) {
    return fail('验证码发送未完成，请稍后重试', error instanceof VerificationSendFailure || error instanceof EmailVerificationFailure ? error.code : 'SAVE_ERROR')
  }
}

async function verifyEmailCode(openid, event) {
  const verificationDb = cloud.database({ throwOnNotFound: false })
  const store = {
    findUser: owner => findUserByOpenid(db, owner),
    emailAvailable: assertEmailAvailable,
    challengeId: verificationDocId,
    claimId: email => stableDocumentId('email:claim', email),
    hash: hashCode,
    now: () => Date.now(),
    run: work => verificationDb.runTransaction(transaction => work({
      get: async (name, id) => (await transaction.collection(name).doc(id).get()).data,
      update: (name, id, fields) => transaction.collection(name).doc(id).update({ data: fields }),
      put: (name, id, fields) => transaction.collection(name).doc(id).set({ data: fields }),
      remove: (name, id) => transaction.collection(name).doc(id).remove(),
    })),
  }
  try { return ok({ user: await confirmSchoolEmail(store, openid, event) }) } catch (error) {
    return fail('邮箱认证未完成，请重试', error instanceof EmailVerificationFailure ? error.code : 'VERIFY_ERROR')
  }
}

// ── updateProfile — Update nickname/avatar with validation + denormalized sync ──

async function updateProfile(openid, event) {
  const profileDb = cloud.database({ throwOnNotFound: false })
  const store = {
    find: owner => findUserByOpenid(db, owner),
    identifier: (owner, version) => stableDocumentId('profile:projection', owner, String(version)),
    now: () => new Date().toISOString(),
    run: work => profileDb.runTransaction(transaction => work({
      read: async id => (await transaction.collection('users').doc(id).get()).data,
      update: (id, fields) => transaction.collection('users').doc(id).update({ data: { ...fields, updated_at: new Date(fields.updated_at) } }),
      enqueue: (id, fields) => transaction.collection('profile_outbox').doc(id).set({ data: { ...fields, created_at: new Date(fields.created_at) } }),
    })),
  }
  try {
    const result = await updateAccountProfile(store, openid, event)
    if (result.outboxId) {
      try { await drainProfileOutbox([result.outboxId]) } catch (_) { console.warn('[users] profile projection deferred') }
    }
    return ok({ user: result.user })
  } catch (error) { return fail('更新失败', error instanceof ProfileUpdateFailure ? error.code : 'UPDATE_ERROR') }
}

// ── Profile projection outbox — owns denormalized author snapshots ──

async function applyAuthorProjection(openid, user) {
  const snapshot = profileSnapshot(user, openid)
  const updates = (prefix) => ({
    [prefix + '.nickname']: snapshot.nickname,
    [prefix + '.avatar_url']: snapshot.avatar_url,
    [prefix + '.profile_version']: snapshot.version,
  })
  const condition = (ownerField, prefix) => _.and([
    { [ownerField]: snapshot.owner, anonymous: _.neq(true) },
    _.or([
      { [prefix + '.profile_version']: _.exists(false) },
      { [prefix + '.profile_version']: _.lt(snapshot.version) },
    ]),
  ])
  // The version predicate must be part of the write, not a preflight read.
  await Promise.all([
    db.collection('posts').where(condition('_openid', 'author')).update({ data: updates('author') }),
    db.collection('comments').where(condition('_openid', 'author')).update({ data: updates('author') }),
    db.collection('notifications').where(condition('actor._openid', 'actor')).update({ data: updates('actor') }),
  ])
}

async function drainProfileOutbox(ids) {
  const candidates = Array.isArray(ids) ? ids : await outboxCandidates(db, 'profile_outbox')
  const results = await Promise.allSettled(candidates.map(async id => {
    const claimed = await claimOutboxEvent(db, 'profile_outbox', id)
    if (!claimed) return false
    try {
      const user = await findUserByOpenid(db, claimed.event.openid)
      if (!user) throw new Error('Profile source is unavailable')
      await applyAuthorProjection(claimed.event.openid, user)
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

async function getPublicProfile(targetOpenid) {
  try {
    return ok({ profile: await readPublicProfile(id => findUserByOpenid(db, id), targetOpenid) })
  } catch (e) {
    return fail('查询失败', e instanceof PublicProfileFailure ? e.code : 'QUERY_ERROR')
  }
}
