export interface PublicProfile { _openid: string; nickname: string; avatar_url: string; created_at?: string }
export function parseProfileId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || value.trim() !== value) throw new Error('Invalid profile ID')
  return value
}
export function parsePublicProfile(value: unknown): PublicProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid public profile')
  const row = value as Record<string, unknown>
  if (typeof row.nickname !== 'string' || !row.nickname || row.nickname.length > 100
    || typeof row.avatar_url !== 'string' || row.avatar_url.length > 2048) throw new Error('Invalid public profile fields')
  const profile: PublicProfile = { _openid: parseProfileId(row._openid), nickname: row.nickname, avatar_url: row.avatar_url }
  if (row.created_at !== undefined) {
    if (typeof row.created_at !== 'string' || new Date(row.created_at).toISOString() !== row.created_at) throw new Error('Invalid profile date')
    profile.created_at = row.created_at
  }
  return profile
}
export function parsePublicProfileResponse(value: unknown, expectedId: string): PublicProfile | null {
  if (!value || typeof value !== 'object' || !('profile' in value)) throw new Error('Missing profile')
  if (value.profile === null) return null
  const profile = parsePublicProfile(value.profile)
  if (profile._openid !== expectedId) throw new Error('Profile ID mismatch')
  return profile
}
