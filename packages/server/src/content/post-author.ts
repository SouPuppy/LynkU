export class PostAuthorFailure extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'EMAIL_NOT_VERIFIED') { super(code) }
}
/** A transaction-local account read prevents a concurrent profile update leaving a stale new post. */
export function currentPostAuthor(value: unknown, owner: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PostAuthorFailure('FORBIDDEN')
  const row = value as Record<string, unknown>
  if (row._openid !== owner) throw new PostAuthorFailure('FORBIDDEN')
  if (row.verified !== true) throw new PostAuthorFailure('EMAIL_NOT_VERIFIED')
  if (typeof row.nickname !== 'string' || !row.nickname || row.nickname.length > 100 || typeof row.avatar_url !== 'string'
    || typeof row.profile_version !== 'number' || !Number.isSafeInteger(row.profile_version) || row.profile_version < 0) throw Error('Invalid post author')
  return { nickname: row.nickname, avatar_url: row.avatar_url, profile_version: row.profile_version }
}
