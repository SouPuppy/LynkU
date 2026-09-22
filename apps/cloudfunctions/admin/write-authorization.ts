import { authorizeAdmin, hasAdminCapability, AdminAuthorizationFailure, type AdminMember, type AdminCapability } from '@lynku/server'
import { record, text, type CloudDatabase, type CloudTransaction } from '../common/database'
function memberOf(value: unknown): AdminMember {
  const row = record(value)
  if (row.kind !== 'business' && row.kind !== 'platform-owner' || row.role !== 'owner' && row.role !== 'community' && row.role !== 'viewer'
    || row.status !== 'active' && row.status !== 'revoked' || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 0) throw Error('Invalid member')
  return { kind: row.kind, role: row.role, status: row.status, version: row.version, webUid: text(row.web_uid), accountId: text(row.account_id) }
}
/** Locate documents outside the transaction; always revalidate their contents inside its read set. */
export async function prepareAdminWriteAuthorization(db: CloudDatabase, webUid: string, capability: AdminCapability) {
  const bindings = (await db.collection('admin_members').where({ web_uid: webUid }).limit(2).get()).data
  if (bindings.length !== 1) throw new AdminAuthorizationFailure('FORBIDDEN')
  const binding = bindings[0]!, memberId = text(binding._id), initial = memberOf(binding)
  let lifecycleId: string | null = null
  if (initial.kind === 'business') {
    const rows = (await db.collection('account_lifecycle').where({ currentAccountId: initial.accountId }).limit(2).get()).data
    if (rows.length !== 1) throw new AdminAuthorizationFailure('FORBIDDEN')
    lifecycleId = text(rows[0]!._id)
  }
  return async (transaction: CloudTransaction) => {
    const principal = await authorizeAdmin({
      member: async () => {
        const value = (await transaction.collection('admin_members').doc(memberId).get()).data
        if (!value) return null
        const current = memberOf(value)
        if (current.accountId !== initial.accountId || current.kind !== initial.kind) throw new AdminAuthorizationFailure('FORBIDDEN')
        return current
      },
      account: async accountId => {
        if (!lifecycleId) return null
        const user = (await transaction.collection('users').doc(accountId).get()).data
        const lifecycle = (await transaction.collection('account_lifecycle').doc(lifecycleId).get()).data
        if (!user || !lifecycle || lifecycle.currentAccountId !== accountId) return null
        const state = lifecycle.state
        if (state !== 'active' && state !== 'closing' && state !== 'closed') throw Error('Invalid lifecycle')
        return { id: text(user._id), lifecycle: state, verified: user.verified === true, role: text(user.role) }
      },
    }, webUid)
    if (!hasAdminCapability(principal, capability)) throw new AdminAuthorizationFailure('FORBIDDEN')
    return principal
  }
}
