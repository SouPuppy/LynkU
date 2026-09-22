import { AdminAuthorizationFailure, changeManagedCategory } from '@lynku/server'
import { prepareAdminWriteAuthorization } from './write-authorization'
import { parseManagedCategory, type CategoryChangeReceipt } from '@lynku/contracts'
import { record, text, type CloudDatabase } from '../common/database'
import { stableDocumentId } from '../common'

function receiptOf(value: unknown): { fingerprint: string; result: CategoryChangeReceipt } {
  const row = record(value), result = record(row.result), appliedAt = text(result.appliedAt)
  if (!Number.isFinite(Date.parse(appliedAt))) throw Error('Invalid receipt date')
  return { fingerprint: text(row.fingerprint), result: { requestId: text(result.requestId), category: parseManagedCategory(result.category), appliedAt } }
}

export async function applyCategoryChange(db: CloudDatabase, webUid: string, input: unknown) {
  const authorize = await prepareAdminWriteAuthorization(db, webUid, 'categories:write')
  return changeManagedCategory({ now: () => new Date().toISOString(), run: work => db.runTransaction(async transaction => {
    let actor: string | null = null
    return work({
      async authorize() {
        const principal = await authorize(transaction)
        actor = principal.accountId
      },
      read: async id => (await transaction.collection('categories').doc(id).get()).data,
      receipt: async requestId => {
        const value = (await transaction.collection('admin_operation_receipts').doc(stableDocumentId('category-change', webUid, requestId)).get()).data
        return value ? receiptOf(value) : null
      },
      update: (id, fields) => transaction.collection('categories').doc(id).update({ data: fields }),
      record: async (requestId, fingerprint, result, reason) => {
        if (!actor) throw new AdminAuthorizationFailure('FORBIDDEN')
        const id = stableDocumentId('category-change', webUid, requestId)
        await transaction.collection('admin_operation_receipts').doc(id).set({ data: { fingerprint, result, actor, createdAt: new Date(result.appliedAt) } })
        await transaction.collection('audit_events').doc(id).set({ data: { action: 'category.update', actor, target: result.category._id, reason,
          requestId, revision: result.category.managementRevision, at: new Date(result.appliedAt), result: 'applied' } })
      },
    })
  }) }, input)
}
