import { parseAdminPostSummary, parseAdminCaseSummary, parseAdminUserDetail, type AdminPostSummary, type AdminCaseSummary, type AdminUserDetail } from '@lynku/contracts'
export type AdminPostView = AdminPostSummary
export interface AdminUserView { id: string; displayName: string; email: string; verified: boolean; role: string; createdAt: string }

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid administration record')
  return value as Record<string, unknown>
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum) throw Error('Invalid administration text')
  return value.trim()
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('Invalid administration count')
  return value
}
function timestamp(value: unknown): string {
  const result = typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : ''
  if (!result || new Date(result).toISOString() !== result) throw Error('Invalid administration timestamp')
  return result
}
function maskEmail(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const [local, domain] = value.split('@')
  if (!local || !domain) return ''
  if (local.length <= 4) return `${local.slice(0, 1)}***${local.slice(-1)}@${domain}`
  return `${local.slice(0, 2)}***${local.slice(-2)}@${domain}`
}

/** Management projections intentionally exclude OPENID, raw author snapshots and anonymous mappings. */
export function projectAdminPost(value: unknown): AdminPostView {
  const source = row(value)
  if (typeof source.anonymous !== 'boolean') throw Error('Invalid administration anonymous state')
  const anonymous = source.anonymous
  const author = source.status === 'deleted' ? '不展示' : anonymous ? '匿名内容'
    : source.author && typeof source.author === 'object' && !Array.isArray(source.author)
      ? text((source.author as Record<string, unknown>).nickname, 100) : '作者资料不可用'
  return parseAdminPostSummary({ id: text(source._id, 128), title: source.title, categoryId: text(source.category_id, 128, true), anonymous,
    authorLabel: author, status: source.status, createdAt: timestamp(source.created_at), commentCount: count(source.comment_count), revision: count(source.revision) })
}

export function projectAdminUser(value: unknown): AdminUserView {
  const source = row(value)
  if (typeof source.verified !== 'boolean') throw Error('Invalid administration verification state')
  return { id: text(source._id, 128), displayName: text(source.nickname, 100), email: maskEmail(source.email), verified: source.verified === true,
    role: text(source.role, 32), createdAt: timestamp(source.created_at) }
}

/** Full school email is available only after a manager intentionally opens one user record. */
export function projectAdminUserDetail(value: unknown): AdminUserDetail {
  const source = row(value)
  const summary = projectAdminUser(source)
  const contactEmail = source.email === undefined || source.email === null ? '' : text(source.email, 254)
  return parseAdminUserDetail({ ...summary, contactEmail })
}

export function projectAdminCase(value: unknown): AdminCaseSummary {
  const source = row(value)
  if (source.targetType !== 'post' && source.targetType !== 'comment') throw Error('Invalid administration case target')
  return parseAdminCaseSummary({ id: text(source._id, 128), targetType: source.targetType, targetId: text(source.targetId, 128), reason: text(source.reasonCode, 100),
    status: source.status, createdAt: timestamp(source.createdAt), updatedAt: timestamp(source.updatedAt), appealed: source.appeal !== undefined })
}
