import { parsePostView, type PostView } from '@lucky/contracts'
/** Database records never become API responses without explicit projection and validation. */
export function projectPost(value: unknown, viewer: string): PostView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored post')
  const row = value as Record<string, unknown>
  if (typeof row._openid !== 'string' || !row._openid) throw new Error('Invalid post owner')
  const timestamp = (value: unknown): string => {
    if (typeof value === 'string') return value
    return new Date(Date.prototype.getTime.call(value)).toISOString()
  }
  return parsePostView({ ...row, is_mine: !!viewer && row._openid === viewer,
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at) })
}
