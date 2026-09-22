export type RestrictedCapability = 'posts' | 'comments' | 'messages'
export interface AccountRestrictions { version: number; posts: string | null; comments: string | null; messages: string | null }
export interface RestrictionChange { accountId: string; expectedVersion: number; capability: RestrictedCapability; until: string | null; reason: string; requestId: string }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid restrictions')
  return value as Record<string, unknown>
}
export function parseAccountRestrictions(value: unknown): AccountRestrictions {
  // A missing field means this existing account has never been restricted.
  if (value === undefined) return { version: 0, posts: null, comments: null, messages: null }
  const row = object(value)
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 0) throw Error('Invalid restriction version')
  const date = (value: unknown): string | null => {
    if (value === null) return null
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw Error('Invalid restriction expiry')
    return value
  }
  return { version: row.version, posts: date(row.posts), comments: date(row.comments), messages: date(row.messages) }
}
export function parseRestrictionChange(value: unknown): RestrictionChange {
  const row = object(value)
  if (typeof row.accountId !== 'string' || !row.accountId || row.accountId.length > 128 || row.accountId.trim() !== row.accountId
    || row.capability !== 'posts' && row.capability !== 'comments' && row.capability !== 'messages'
    || typeof row.expectedVersion !== 'number' || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 0
    || typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(row.requestId)
    || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500) throw Error('Invalid restriction change')
  const limits = parseAccountRestrictions({ version: 0, posts: null, comments: null, messages: null, [row.capability]: row.until })
  return { accountId: row.accountId, capability: row.capability, until: limits[row.capability], expectedVersion: row.expectedVersion, reason: row.reason.trim(), requestId: row.requestId }
}
