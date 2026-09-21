// cloud function: categories — Category listing + admin CRUD
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()
const { ok, fail, validateInput, authorizeAction, withAuth } = require('../common')
const { DEFAULT_CATEGORIES } = require('@lucky/server')
const REMOVED_CATEGORY_NAMES = new Set(['二手交易'])

exports.main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'categories', event.action)
  if (!authorization.allowed) return authorization.response
  switch (event.action) {
    case 'list': return listCategories()
    case 'seed': return seedCategories()
    case 'create': return createCategory(event)
    case 'update': return updateCategory(event)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})

async function listCategories() {
  try { const res = await db.collection('categories').where({ status: 'active' }).orderBy('sort_order', 'asc').get()
    return ok({ categories: res.data.filter(category => !REMOVED_CATEGORY_NAMES.has(category.name)) }) }
  catch (e) { return fail('查询失败', 'QUERY_ERROR') }
}

async function createCategory(event) {
  const nv = validateInput(event.name, { maxLen: 50 })
  if (!nv.valid) return fail(nv.error, 'INVALID_INPUT')
  if (REMOVED_CATEGORY_NAMES.has(nv.value)) return fail('该分类不可用', 'INVALID_CATEGORY')
  const dv = validateInput(event.description || '', { allowEmpty: true, maxLen: 500 })
  if (!dv.valid) return fail(dv.error, 'INVALID_INPUT')
  try { const ex = await db.collection('categories').where({ name: nv.value }).get()
    if (ex.data.length > 0) return fail('分类名称已存在', 'DUPLICATE_NAME') }
  catch (e) { return fail('查询失败', 'QUERY_ERROR') }
  let maxSort = 0
  try { const last = await db.collection('categories').orderBy('sort_order', 'desc').limit(1).get()
    if (last.data.length > 0) maxSort = last.data[0].sort_order } catch (_) {}
  try {
    const cat = { name: nv.value, description: dv.value, sort_order: maxSort + 1, post_count: 0, status: 'active' }
    const res = await db.collection('categories').add({ data: cat })
    return ok({ category: { ...cat, _id: res._id } })
  } catch (e) { return fail('创建失败', 'CREATE_ERROR') }
}

async function seedCategories() {
  // Idempotent: only inserts if collection is empty
  try {
    const existing = await db.collection('categories').where({ status: 'active' }).count()
    if (existing.total > 0) return ok({ categories: [], seeded: false })
  } catch (_) { /* collection may not exist yet — try insert anyway */ }

  const results = []
  for (const cat of DEFAULT_CATEGORIES) {
    try {
      const res = await db.collection('categories').add({
        data: { ...cat, post_count: 0, status: 'active' }
      })
      results.push({ ...cat, _id: res._id, post_count: 0, status: 'active' })
    } catch (e) {
      // Skip duplicates
      if (e.errCode !== -502001) console.warn('[seed] insert failed for', cat.name, e.message)
    }
  }
  return ok({ categories: results, seeded: results.length > 0 })
}

async function updateCategory(event) {
  const { category_id, name, description, status } = event
  const updates = {}
  if (name !== undefined) { const v = validateInput(name, { maxLen: 50 }); if (!v.valid) return fail(v.error, 'INVALID_INPUT'); updates.name = v.value }
  if (description !== undefined) { const v = validateInput(description, { allowEmpty: true, maxLen: 500 }); if (!v.valid) return fail(v.error, 'INVALID_INPUT'); updates.description = v.value }
  if (status !== undefined && ['active', 'hidden'].includes(status)) updates.status = status
  if (Object.keys(updates).length === 0) return fail('没有需要更新的字段', 'INVALID_INPUT')
  try { await db.collection('categories').doc(category_id).update({ data: updates })
    const updated = await db.collection('categories').doc(category_id).get(); return ok({ category: updated.data }) }
  catch (e) { return fail('更新失败', 'UPDATE_ERROR') }
}
