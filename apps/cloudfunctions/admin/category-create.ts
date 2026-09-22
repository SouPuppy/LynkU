import { createManagedCategory, AdminAuthorizationFailure, CategoryChangeFailure } from '@lynku/server'
import { parseCategoryChangeReceipt } from '@lynku/contracts'
import { prepareAdminWriteAuthorization } from './write-authorization'
import { record, text, type CloudDatabase } from '../common/database'
import { stableDocumentId } from '../common'
export async function applyCategoryCreation(db: CloudDatabase, webUid: string, input: unknown) {
  const authorize = await prepareAdminWriteAuthorization(db, webUid, 'categories:write')
  try { return await createManagedCategory({ now: () => new Date().toISOString(), identifier: requestId => stableDocumentId('managed-category', webUid, requestId), run: work => db.runTransaction(async tx => {
    let actor = ''
    return work({
      authorize: async () => { actor = (await authorize(tx)).accountId },
      receipt: async requestId => {
        const prior = (await tx.collection('admin_operation_receipts').doc(stableDocumentId('category-create', webUid, requestId)).get()).data
        return prior ? { fingerprint: text(prior.fingerprint), result: parseCategoryChangeReceipt(prior.result) } : null
      },
      count: async () => {
        const catalog = (await tx.collection('category_catalog').doc('total').get()).data
        if (!catalog || typeof catalog.count !== 'number') throw Error('Category catalog is not initialized')
        return catalog.count
      },
      exists: async id => (await tx.collection('categories').doc(id).get()).data !== null,
      create: category => { const { _id, ...fields } = category; return tx.collection('categories').doc(_id).set({ data: fields }) },
      incrementCount: expected => tx.collection('category_catalog').doc('total').update({ data: { count: expected + 1 } }),
      record: async (requestId, fingerprint, result, reason) => {
        if (!actor) throw new AdminAuthorizationFailure('FORBIDDEN')
        const id = stableDocumentId('category-create', webUid, requestId), at = new Date(result.appliedAt)
        await tx.collection('admin_operation_receipts').doc(id).set({ data: { actor, fingerprint, result: record(result), createdAt: at } })
        await tx.collection('audit_events').doc(id).set({ data: { actor, action: 'category.create', target: result.category._id, requestId, reason, revision: 1, result: 'applied', at } })
      },
    })
  }) }, input) } catch (error) {
    // A unique name index arbitrates concurrent creates and renames; never overwrite the winner.
    if (error && typeof error === 'object') {
      const fields = error as Record<string, unknown>
      if (fields.code === 11000 || [fields.message, fields.errMsg].some(value => typeof value === 'string' && value.includes('E11000'))) throw new CategoryChangeFailure('CONFLICT')
    }
    throw error
  }
}
