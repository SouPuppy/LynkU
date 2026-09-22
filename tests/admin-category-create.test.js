const test = require('node:test')
const assert = require('node:assert/strict')
const { require: loadTs } = require('tsx/cjs/api')
const { applyCategoryCreation } = loadTs('../apps/cloudfunctions/admin/category-create.ts', __filename)
function fixture(options = {}) {
  let data = new Map([
    ['admin_members/owner', { _id: 'owner', web_uid: 'trusted', account_id: 'platform-owner:trusted', kind: 'platform-owner', role: 'owner', status: 'active', version: 1 }],
    ['category_catalog/total', { _id: 'total', count: options.count ?? 0 }],
  ])
  let tail = Promise.resolve()
  const db = {
    collection: name => ({ where: query => ({ limit: () => ({ get: async () => ({ data: [...data.entries()].filter(([key, value]) => key.startsWith(`${name}/`) && Object.entries(query).every(([field, expected]) => value[field] === expected)).map(([, value]) => value) }) }) }) }),
    runTransaction: work => {
      const run = tail.then(async () => {
        const next = new Map(data)
        if (options.revoked) next.set('admin_members/owner', { ...next.get('admin_members/owner'), status: 'revoked' })
        const value = await work({ collection: name => ({ doc: id => {
          const key = `${name}/${id}`
          return { get: async () => ({ data: next.get(key) ?? null }), update: async ({ data: fields }) => { next.set(key, { ...next.get(key), ...fields }) },
            set: async ({ data: fields }) => {
              if (options.failAudit && name === 'audit_events') throw Error('audit offline')
              if (name === 'categories' && [...next.entries()].some(([key, value]) => key.startsWith('categories/') && value.name === fields.name)) throw Object.assign(Error('E11000 duplicate key'), { code: 11000 })
              next.set(key, { _id: id, ...fields })
            } }
        } }) })
        data = next; return value
      })
      tail = run.catch(() => {}); return run
    },
  }
  return { db, data: () => data }
}
const request = { name: '新分类', description: '描述', sort_order: 6, status: 'active', requestId: 'category-create-0001', reason: '新增讨论范围' }
test('category creation retry returns one version, one category and one catalog increment', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([applyCategoryCreation(f.db, 'trusted', request), applyCategoryCreation(f.db, 'trusted', request)])
  assert.deepEqual(a, b); assert.equal(a.category.managementRevision, 1); assert.equal(a.category.post_count, 0)
  assert.equal(f.data().get('category_catalog/total').count, 1)
  assert.equal([...f.data().keys()].filter(key => key.startsWith('audit_events/')).length, 1)
  await assert.rejects(applyCategoryCreation(f.db, 'trusted', { ...request, description: 'different' }), { code: 'CONFLICT' })
  await assert.rejects(applyCategoryCreation(f.db, 'trusted', { ...request, requestId: 'category-create-0002' }), { code: 'CONFLICT' })
  assert.equal(f.data().get('category_catalog/total').count, 1)
})
test('catalog capacity serializes concurrent creation and audit failure rolls back all writes', async () => {
  const capped = fixture({ count: 99 })
  const results = await Promise.allSettled([applyCategoryCreation(capped.db, 'trusted', request), applyCategoryCreation(capped.db, 'trusted', { ...request, name: '另一个分类', requestId: 'category-create-0002' })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(capped.data().get('category_catalog/total').count, 100)
  for (const options of [{ failAudit: true }, { revoked: true }]) {
    const f = fixture(options)
    await assert.rejects(applyCategoryCreation(f.db, 'trusted', request))
    assert.equal(f.data().get('category_catalog/total').count, 0)
    assert.equal([...f.data().keys()].some(key => key.startsWith('categories/')), false)
  }
})
