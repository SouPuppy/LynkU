import type { SelfProfile } from '@lynku/contracts'
import { projectSelfProfile } from './self-profile'
type VerificationCode = 'INVALID_EMAIL' | 'INVALID_CODE' | 'NOT_FOUND' | 'CODE_NOT_FOUND' | 'CODE_EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'EMAIL_IN_USE'
export class EmailVerificationFailure extends Error {
  constructor(readonly code: VerificationCode) { super(code) }
}
type Collection = 'users' | 'email_verifications' | 'email_claims'
export interface EmailVerificationTransaction {
  get(collection: Collection, id: string): Promise<unknown | null>
  update(collection: Collection, id: string, fields: Record<string, unknown>): Promise<void>
  put(collection: Collection, id: string, fields: Record<string, unknown>): Promise<void>
  remove(collection: Collection, id: string): Promise<void>
}
export interface EmailVerificationStore {
  findUser(owner: string): Promise<unknown | null>
  emailAvailable(email: string, owner: string): Promise<boolean>
  run<T>(work: (transaction: EmailVerificationTransaction) => Promise<T>): Promise<T>
  challengeId(owner: string, email: string): string
  claimId(email: string): string
  hash(owner: string, email: string, code: string): string
  now(): number
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid stored verification')
  return value as Record<string, unknown>
}
export function schoolEmail(value: unknown): string {
  if (typeof value !== 'string') throw new EmailVerificationFailure('INVALID_EMAIL')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[a-z0-9._%+-]+@nottingham\.edu\.cn$/.test(email)) throw new EmailVerificationFailure('INVALID_EMAIL')
  return email
}
export async function confirmSchoolEmail(store: EmailVerificationStore, owner: string, input: unknown): Promise<SelfProfile> {
  const request = row(input)
  const email = schoolEmail(request.email)
  if (typeof request.code !== 'string' || !/^\d{6}$/.test(request.code) || request.code.length !== 6) throw new EmailVerificationFailure('INVALID_CODE')
  const user = await store.findUser(owner)
  if (user === null) throw new EmailVerificationFailure('NOT_FOUND')
  const initial = row(user)
  if (typeof initial._id !== 'string' || !initial._id || initial._openid !== owner) throw Error('Invalid account owner')
  // Preserve already verified accounts until their ownership claims have been migrated.
  if (!(await store.emailAvailable(email, owner))) throw new EmailVerificationFailure('EMAIL_IN_USE')
  const accountId = initial._id
  const challengeId = store.challengeId(owner, email)
  const claimId = store.claimId(email)
  const hash = store.hash(owner, email, request.code)
  const result = await store.run(async transaction => {
    const accountValue = await transaction.get('users', accountId)
    const challengeValue = await transaction.get('email_verifications', challengeId)
    const claimValue = await transaction.get('email_claims', claimId)
    if (accountValue === null) throw new EmailVerificationFailure('NOT_FOUND')
    const account = row(accountValue)
    const profile = projectSelfProfile(account, owner)
    if (challengeValue === null) throw new EmailVerificationFailure('CODE_NOT_FOUND')
    const challenge = row(challengeValue)
    if (challenge.email !== email) throw new EmailVerificationFailure('CODE_NOT_FOUND')
    if (challenge._openid !== owner || typeof challenge.code_hash !== 'string'
      || typeof challenge.consumed !== 'boolean' || !Number.isSafeInteger(challenge.attempts) || Number(challenge.attempts) < 0
      || !Number.isSafeInteger(challenge.expires_at_ms)) throw Error('Invalid stored challenge')
    if (claimValue !== null) {
      const claim = row(claimValue)
      if (claim.email !== email || typeof claim.owner_openid !== 'string' || !claim.owner_openid) throw Error('Invalid email claim')
      if (claim.owner_openid !== owner) throw new EmailVerificationFailure('EMAIL_IN_USE')
    }
    if (challenge.consumed) {
      if (challenge.code_hash === hash && profile.verified && profile.email === email) return { user: profile }
      throw new EmailVerificationFailure('CODE_NOT_FOUND')
    }
    if (challenge.delivery_status !== 'sent') throw new EmailVerificationFailure('CODE_NOT_FOUND')
    const now = store.now()
    if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid verification clock')
    if (now >= Number(challenge.expires_at_ms)) throw new EmailVerificationFailure('CODE_EXPIRED')
    if (Number(challenge.attempts) >= 5) throw new EmailVerificationFailure('TOO_MANY_ATTEMPTS')
    if (challenge.code_hash !== hash) {
      await transaction.update('email_verifications', challengeId, { attempts: Number(challenge.attempts) + 1 })
      return { error: 'INVALID_CODE' as const }
    }
    const oldClaimId = profile.verified && profile.email && profile.email !== email ? store.claimId(profile.email) : null
    const oldClaim = oldClaimId ? await transaction.get('email_claims', oldClaimId) : null
    if (oldClaim !== null && row(oldClaim).owner_openid !== owner) throw Error('Previous email owner mismatch')
    const updates = { email, verified: true, verified_at: new Date(now).toISOString(), email_pending: '', updated_at: new Date(now).toISOString() }
    const updated = projectSelfProfile({ ...account, ...updates }, owner)
    await transaction.put('email_claims', claimId, { email, owner_openid: owner, verified_at: updates.verified_at })
    await transaction.update('users', accountId, updates)
    await transaction.update('email_verifications', challengeId, { consumed: true })
    if (oldClaimId && oldClaim) await transaction.remove('email_claims', oldClaimId)
    return { user: updated }
  })
  if ('error' in result) throw new EmailVerificationFailure(result.error!)
  return result.user
}
