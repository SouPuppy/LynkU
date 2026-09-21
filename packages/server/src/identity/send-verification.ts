import { schoolEmail } from './verify-email'
import { projectSelfProfile } from './self-profile'
type Collection = 'users' | 'email_verifications' | 'email_send_limits'
interface SendTransaction {
  get(collection: Collection, id: string): Promise<unknown | null>
  put(collection: Collection, id: string, value: Record<string, unknown>): Promise<void>
  update(collection: Collection, id: string, value: Record<string, unknown>): Promise<void>
}
export interface VerificationSendStore {
  findUser(owner: string): Promise<unknown | null>
  emailAvailable(email: string, owner: string): Promise<boolean>
  run<T>(work: (transaction: SendTransaction) => Promise<T>): Promise<T>
  identifier(owner: string): string
  code(): string
  generation(): string
  hash(owner: string, email: string, code: string): string
  now(): number
  send(email: string, code: string): Promise<unknown>
}
export class VerificationSendFailure extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'EMAIL_IN_USE' | 'EMAIL_RATE_LIMITED' | 'EMAIL_SEND_FAILED') { super(code) }
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid verification state')
  return value as Record<string, unknown>
}
export async function sendSchoolVerification(store: VerificationSendStore, owner: string, input: unknown): Promise<{ email: string; expiresIn: number }> {
  const email = schoolEmail(row(input).email)
  const value = await store.findUser(owner)
  if (value === null) throw new VerificationSendFailure('NOT_FOUND')
  const account = row(value)
  projectSelfProfile(account, owner)
  if (typeof account._id !== 'string' || !account._id) throw Error('Invalid account ID')
  const accountId = account._id
  if (!(await store.emailAvailable(email, owner))) throw new VerificationSendFailure('EMAIL_IN_USE')
  const now = store.now()
  const code = store.code()
  const generation = store.generation()
  if (!Number.isSafeInteger(now) || now < 0 || code.length !== 6 || !/^\d{6}$/.test(code) || !generation) throw Error('Invalid verification generator')
  const id = store.identifier(owner)
  const hash = store.hash(owner, email, code)
  await store.run(async transaction => {
    const current = await transaction.get('email_send_limits', id)
    let windowStart = now, count = 0
    if (current !== null) {
      const limit = row(current)
      if (limit.owner_openid !== owner || !Number.isSafeInteger(limit.last_sent_at) || !Number.isSafeInteger(limit.window_start)
        || !Number.isSafeInteger(limit.count) || Number(limit.count) < 1) throw Error('Invalid send limit')
      if (now - Number(limit.last_sent_at) < 60000) throw new VerificationSendFailure('EMAIL_RATE_LIMITED')
      if (now - Number(limit.window_start) < 3600000) { windowStart = Number(limit.window_start); count = Number(limit.count) }
      if (count >= 5) throw new VerificationSendFailure('EMAIL_RATE_LIMITED')
    }
    await transaction.put('email_send_limits', id, { owner_openid: owner, last_sent_at: now, window_start: windowStart, count: count + 1 })
    await transaction.put('email_verifications', id, { _openid: owner, email, generation, code_hash: hash,
      created_at_ms: now, expires_at_ms: now + 600000, attempts: 0, consumed: false, delivery_status: 'sending' })
  })
  let sent = false
  try { await store.send(email, code); sent = true } catch (_) { /* Record failure without provider details or code. */ }
  const current = await store.run(async transaction => {
    const value = await transaction.get('email_verifications', id)
    if (value === null) throw Error('Missing reserved challenge')
    const challenge = row(value)
    if (challenge.generation !== generation) return false
    if (challenge._openid !== owner || challenge.email !== email) throw Error('Challenge ownership mismatch')
    const account = await transaction.get('users', accountId)
    if (account === null) throw new VerificationSendFailure('NOT_FOUND')
    projectSelfProfile(account, owner)
    await transaction.update('email_verifications', id, { delivery_status: sent ? 'sent' : 'failed', consumed: !sent })
    if (sent) await transaction.update('users', accountId, { email_pending: email, email_requested_at: new Date(now).toISOString() })
    return true
  })
  if (!sent || !current) throw new VerificationSendFailure('EMAIL_SEND_FAILED')
  return { email, expiresIn: Math.max(0, Math.floor((now + 600000 - store.now()) / 1000)) }
}
