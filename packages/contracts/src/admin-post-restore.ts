export interface RestoreGovernedPostRequest {
  requestId: string
  postId: string
  caseId: string
  expectedRevision: number
  reason: string
}

export interface RestoreGovernedPostReceipt {
  requestId: string
  post: { id: string; revision: number; status: 'published' }
  appliedAt: string
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid post restoration')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.trim() !== value || /[\x00-\x1f]/.test(value)) throw Error('Invalid post restoration text')
  return value
}
function requestId(value: unknown): string {
  const result = text(value, 80)
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(result)) throw Error('Invalid post restoration request ID')
  return result
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) throw Error('Invalid post restoration revision')
  return value
}
function timestamp(value: unknown): string {
  const result = text(value, 30)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw Error('Invalid post restoration timestamp')
  return result
}

export function parseRestoreGovernedPostRequest(value: unknown): RestoreGovernedPostRequest {
  const row = object(value)
  if (Object.keys(row).some(key => !['requestId', 'postId', 'caseId', 'expectedRevision', 'reason'].includes(key))) throw Error('Unexpected post restoration field')
  return { requestId: requestId(row.requestId), postId: text(row.postId, 128), caseId: text(row.caseId, 128), expectedRevision: revision(row.expectedRevision), reason: text(row.reason, 1000) }
}

export function parseRestoreGovernedPostReceipt(value: unknown): RestoreGovernedPostReceipt {
  const row = object(value), post = object(row.post)
  if (Object.keys(row).some(key => !['requestId', 'post', 'appliedAt'].includes(key)) || Object.keys(post).some(key => !['id', 'revision', 'status'].includes(key))
    || post.status !== 'published') throw Error('Invalid post restoration receipt')
  return { requestId: requestId(row.requestId), post: { id: text(post.id, 128), revision: revision(post.revision), status: 'published' }, appliedAt: timestamp(row.appliedAt) }
}
