export interface AdminMemberView { id: string; kind: 'business' | 'platform-owner'; role: 'owner' | 'community' | 'viewer'; status: 'active' | 'revoked'; version: number }
export interface AdminMemberChange { id: string; role: AdminMemberView['role']; status: AdminMemberView['status']; expectedVersion: number; requestId: string; reason: string }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid member input')
  return value as Record<string, unknown>
}
export function parseAdminMember(value: unknown): AdminMemberView {
  const row = object(value)
  if (typeof row.id !== 'string' || !row.id || row.id.length > 128 || row.id.trim() !== row.id
    || row.kind !== 'business' && row.kind !== 'platform-owner'
    || row.role !== 'owner' && row.role !== 'community' && row.role !== 'viewer'
    || row.status !== 'active' && row.status !== 'revoked'
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 0) throw Error('Invalid member')
  return { id: row.id, kind: row.kind, role: row.role, status: row.status, version: row.version }
}
export function parseAdminMemberChange(value: unknown): AdminMemberChange {
  const row = object(value)
  const member = parseAdminMember({ ...row, kind: 'business', version: row.expectedVersion })
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(row.requestId)
    || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500) throw Error('Invalid change')
  return { id: member.id, role: member.role, status: member.status, expectedVersion: member.version, requestId: row.requestId, reason: row.reason.trim() }
}
export function parseAdminMembers(value: unknown): AdminMemberView[] {
  if (!Array.isArray(value) || value.length > 100) throw Error('Invalid member list')
  const members = value.map(parseAdminMember)
  if (new Set(members.map(member => member.id)).size !== members.length) throw Error('Duplicate member')
  return members
}
