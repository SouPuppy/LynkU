import { changeAccountRestrictions, AdminAuthorizationFailure } from '@lynku/server'
import { parseAccountRestrictions } from '@lynku/contracts'
import { prepareAdminWriteAuthorization } from './write-authorization'
import { record, text, type CloudDatabase } from '../common/database'
import { stableDocumentId } from '../common'
export async function applyAccountRestriction(db: CloudDatabase, webUid: string, input: unknown) {
  const authorize = await prepareAdminWriteAuthorization(db, webUid, 'governance:write')
  return changeAccountRestrictions({ now: () => new Date().toISOString(), run: work => db.runTransaction(async transaction => {
    let actor = ''
    return work({
      authorize: async () => { actor = (await authorize(transaction)).accountId },
      read: async id => (await transaction.collection('users').doc(id).get()).data,
      receipt: async requestId => {
        const value = (await transaction.collection('admin_operation_receipts').doc(stableDocumentId('account-restriction', webUid, requestId)).get()).data
        return value ? { fingerprint: text(value.fingerprint), restrictions: parseAccountRestrictions(value.restrictions) } : null
      },
      update: (id, restrictions) => transaction.collection('users').doc(id).update({ data: { restrictions: record(restrictions) } }),
      record: async (requestId, fingerprint, accountId, restrictions, reason) => {
        if (!actor) throw new AdminAuthorizationFailure('FORBIDDEN')
        const id = stableDocumentId('account-restriction', webUid, requestId), at = new Date()
        await transaction.collection('admin_operation_receipts').doc(id).set({ data: { actor, fingerprint, restrictions: record(restrictions), createdAt: at } })
        await transaction.collection('audit_events').doc(id).set({ data: { actor, action: 'account.restriction.changed', target: accountId, reason, requestId, revision: restrictions.version, result: 'applied', at } })
      },
    })
  }) }, input)
}
