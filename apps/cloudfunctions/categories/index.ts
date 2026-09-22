import * as cloud from 'wx-server-sdk'
import { connectDatabase, CLOUD_DATABASE_OPTIONS } from '../common/database'
cloud.init()
const db = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
import { ok, fail, authorizeAction, withAuth, stableDocumentId } from '../common'
import { listActiveCategories, createCategoryRecord, seedDefaultCategories, CategoryFailure, type CategoryStore } from '@lynku/server'

const store: CategoryStore = {
  list: async () => (await db.collection('categories').where({ status: 'active' }).orderBy('sort_order', 'asc').orderBy('_id', 'asc').limit(101).get()).data,
  named: async name => (await db.collection('categories').where({ name }).limit(2).get()).data,
  async lastSort() {
    const rows = (await db.collection('categories').orderBy('sort_order', 'desc').limit(1).get()).data
    if (rows.length === 0) return 0
    const order = rows[0]?.sort_order
    if (typeof order !== 'number' || !Number.isSafeInteger(order)) throw Error('Invalid category order')
    return order
  },
  identifier: name => stableDocumentId('category', name),
  run: work => db.runTransaction(transaction => work({
    read: async id => (await transaction.collection('categories').doc(id).get()).data,
    put: (id, category) => {
      const { _id, ...data } = category
      return transaction.collection('categories').doc(id).set({ data: { ...data, managementRevision: 0 } })
    },
    update: (id, fields) => transaction.collection('categories').doc(id).update({ data: fields }),
  })),
}
export const main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'categories', event.action)
  if (!authorization.allowed) return authorization.response
  try {
    switch (event.action) {
      case 'list': return ok(await listActiveCategories(store))
      case 'seed': return ok(await seedDefaultCategories(store))
      case 'create': return ok(await createCategoryRecord(store, event))
      default: return fail('未知操作', 'UNKNOWN_ACTION')
    }
  } catch (error) {
    return fail('分类操作未完成，请重试', error instanceof CategoryFailure ? error.code : 'OPERATION_ERROR')
  }
})
