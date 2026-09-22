import * as cloud from 'wx-server-sdk'
import { connectDatabase, CLOUD_DATABASE_OPTIONS } from '../common/database'
cloud.init()
const db = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
import { ok, fail, authorizeAction, withAuth } from '../common'
import { listActiveCategories } from '@lynku/server'

const store = {
  list: async () => (await db.collection('categories').where({ status: 'active' }).orderBy('sort_order', 'asc').orderBy('_id', 'asc').limit(101).get()).data,
}
export const main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'categories', event.action)
  if (!authorization.allowed) return authorization.response
  try {
    switch (event.action) {
      case 'list': return ok(await listActiveCategories(store))
      default: return fail('未知操作', 'UNKNOWN_ACTION')
    }
  } catch (_) {
    return fail('分类暂时无法读取，请重试', 'QUERY_ERROR')
  }
})
