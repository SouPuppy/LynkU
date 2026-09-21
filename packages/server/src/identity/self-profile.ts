import { parseSelfProfile, type SelfProfile } from '@lucky/contracts'

/** Private account DTO: database IDs, outbox versions and future internal fields stay on the server. */
export function projectSelfProfile(value: unknown, owner: string): SelfProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored account')
  const row = value as Record<string, unknown>
  if (!owner || row._openid !== owner) throw new Error('Account ownership mismatch')
  const timestamps: Record<string, unknown> = {}
  for (const field of ['verified_at', 'email_requested_at']) {
    const value = row[field]
    if (value == null) continue
    timestamps[field] = typeof value === 'string' ? value : new Date(Date.prototype.getTime.call(value)).toISOString()
  }
  return parseSelfProfile({ ...row, ...timestamps })
}
