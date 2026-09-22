import { parseAdminMemberChange, parseAdminMember, type AdminMemberView } from '@lynku/contracts'
export class AdminMemberChangeFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT', message: string) { super(message) }
}
export interface MemberChangeTransaction {
  /** Return the document ID of the authorized active owner, read inside the same transaction. */
  authorize(): Promise<string>
  receipt(requestId: string): Promise<{ fingerprint: string; member: AdminMemberView } | null>
  read(id: string): Promise<AdminMemberView | null>
  update(member: AdminMemberView): Promise<void>
  record(requestId: string, fingerprint: string, member: AdminMemberView, reason: string): Promise<void>
}
export async function changeAdminMember(store: { run<T>(work: (tx: MemberChangeTransaction) => Promise<T>): Promise<T> }, input: unknown): Promise<AdminMemberView> {
  let request
  try { request = parseAdminMemberChange(input) } catch { throw new AdminMemberChangeFailure('INVALID_INPUT', '请填写有效的权限、版本及原因') }
  const fingerprint = JSON.stringify([request.id, request.role, request.status, request.expectedVersion, request.reason])
  return store.run(async tx => {
    const actorId = await tx.authorize()
    const previous = await tx.receipt(request.requestId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new AdminMemberChangeFailure('CONFLICT', '请求编号已用于其他修改')
      return previous.member
    }
    const current = await tx.read(request.id)
    if (!current) throw new AdminMemberChangeFailure('NOT_FOUND', '管理员记录不存在')
    if (current.version !== request.expectedVersion || current.version >= Number.MAX_SAFE_INTEGER) throw new AdminMemberChangeFailure('CONFLICT', '权限已经变化，请刷新后重试')
    // Requiring a different active owner to make changes preserves at least that owner.
    // Both actor and target participate in the read set, preventing mutual revocation races.
    if (actorId === current.id) throw new AdminMemberChangeFailure('CONFLICT', '不能修改自己的管理资格，请由另一位所有者操作')
    if (current.kind === 'platform-owner' && request.role !== 'owner') throw new AdminMemberChangeFailure('INVALID_INPUT', '独立平台账号只支持所有者角色')
    const member = parseAdminMember({ ...current, role: request.role, status: request.status, version: current.version + 1 })
    await tx.update(member)
    await tx.record(request.requestId, fingerprint, member, request.reason)
    return member
  })
}
