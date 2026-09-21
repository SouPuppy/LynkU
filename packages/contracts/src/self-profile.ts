/** The private account response is distinct from both database records and public author cards. */
export interface SelfProfile {
  _openid: string
  nickname: string
  avatar_url: string
  role: 'user' | 'admin'
  email: string
  verified: boolean
  verified_at?: string
  email_pending?: string
  email_requested_at?: string
}
export function parseSelfProfile(value: unknown): SelfProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid profile')
  const row = value as Record<string, unknown>
  const text = (value: unknown, max: number, empty = false): string => {
    if (typeof value !== 'string' || (!empty && !value) || value.length > max) throw new Error('Invalid profile field')
    return value
  }
  if (typeof row.verified !== 'boolean' || (row.role !== 'user' && row.role !== 'admin')) throw new Error('Invalid profile permissions')
  const profile: SelfProfile = { _openid: text(row._openid, 128), nickname: text(row.nickname, 100),
    avatar_url: text(row.avatar_url, 2048, true), email: text(row.email, 254, true), role: row.role, verified: row.verified }
  if (row.email_pending !== undefined) profile.email_pending = text(row.email_pending, 254, true)
  for (const field of ['verified_at', 'email_requested_at'] as const) {
    if (row[field] === undefined || row[field] === null) continue
    const date = text(row[field], 30)
    if (new Date(date).toISOString() !== date) throw new Error('Invalid profile timestamp')
    profile[field] = date
  }
  return profile
}
export function parseSelfProfileResponse(value: unknown): SelfProfile {
  if (!value || typeof value !== 'object' || !('user' in value)) throw new Error('Missing user')
  return parseSelfProfile(value.user)
}
