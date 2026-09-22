import { parseProfileId, parsePublicProfile, type PublicProfile } from '@lynku/contracts'
export class PublicProfileFailure extends Error {
  readonly code = 'INVALID_INPUT'
}
export async function readPublicProfile(find: (id: string) => Promise<unknown | null>, input: unknown): Promise<PublicProfile | null> {
  let id: string
  try { id = parseProfileId(input) } catch (_) { throw new PublicProfileFailure('Invalid profile ID') }
  const value = await find(id)
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored profile')
  const row = value as Record<string, unknown>
  if (row._openid !== id) throw new Error('Profile ID mismatch')
  const createdAt = typeof row.created_at === 'string' ? row.created_at
    : new Date(Date.prototype.getTime.call(row.created_at)).toISOString()
  return parsePublicProfile({ ...row, created_at: createdAt })
}
