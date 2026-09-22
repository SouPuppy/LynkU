import { parseAccountRestrictions, parseRestrictionChange, type AccountRestrictions } from '@lynku/contracts'
import { AccountRestrictionFailure } from '../shared'
export { AccountRestrictionFailure, assertAccountCapability } from '../shared'
export interface RestrictionTransaction {
  authorize(): Promise<void>
  read(id: string): Promise<Record<string, unknown> | null>
  receipt(id: string): Promise<{ fingerprint: string; restrictions: AccountRestrictions } | null>
  update(id: string, restrictions: AccountRestrictions): Promise<void>
  record(id: string, fingerprint: string, accountId: string, restrictions: AccountRestrictions, reason: string): Promise<void>
}
export async function changeAccountRestrictions(store: { now(): string; run<T>(work: (tx: RestrictionTransaction) => Promise<T>): Promise<T> }, value: unknown): Promise<AccountRestrictions> {
  let request
  try { request = parseRestrictionChange(value) } catch { throw new AccountRestrictionFailure('INVALID_INPUT', '限制参数无效') }
  const fingerprint = JSON.stringify([request.accountId, request.capability, request.until, request.expectedVersion, request.reason])
  return store.run(async tx => {
    await tx.authorize()
    const receipt = await tx.receipt(request.requestId)
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new AccountRestrictionFailure('CONFLICT', '请求已用于另一项操作')
      return receipt.restrictions
    }
    const now = Date.parse(store.now()), end = request.until === null ? null : Date.parse(request.until)
    if (!Number.isFinite(now)) throw Error('Invalid restriction clock')
    if (end !== null && (end <= now || end - now > 30 * 86400000)) throw new AccountRestrictionFailure('INVALID_INPUT', '限制期限应在未来30天以内')
    const account = await tx.read(request.accountId)
    if (!account || account._id !== request.accountId) throw new AccountRestrictionFailure('NOT_FOUND', '账号不存在')
    const previous = parseAccountRestrictions(account.restrictions)
    if (previous.version !== request.expectedVersion || previous.version >= Number.MAX_SAFE_INTEGER) throw new AccountRestrictionFailure('CONFLICT', '限制已变化，请刷新')
    const restrictions = { ...previous, [request.capability]: request.until, version: previous.version + 1 }
    await tx.update(request.accountId, restrictions)
    await tx.record(request.requestId, fingerprint, request.accountId, restrictions, request.reason)
    return restrictions
  })
}
