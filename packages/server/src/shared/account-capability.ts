import { parseAccountRestrictions, type RestrictedCapability } from '@lynku/contracts'
export class AccountRestrictionFailure extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'INVALID_INPUT' | 'CONFLICT' | 'NOT_FOUND', message: string) { super(message) }
}
export function assertAccountCapability(account: unknown, capability: RestrictedCapability, now: string): void {
  if (!account || typeof account !== 'object' || Array.isArray(account) || !Number.isFinite(Date.parse(now))) throw Error('Account capability unavailable')
  const state = parseAccountRestrictions((account as Record<string, unknown>).restrictions)
  const until = state[capability]
  if (until !== null && Date.parse(until) > Date.parse(now)) throw new AccountRestrictionFailure('FORBIDDEN', `该功能暂时受限，至 ${until}`)
}
