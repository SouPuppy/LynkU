const test = require('node:test')
const assert = require('node:assert/strict')
const { listActiveCategories, listAdminCategories, createCategoryRecord, updateCategoryRecord, seedDefaultCategories } = require('@lynku/server')
const base = { _id: 'campus', name: 'Campus', description: '', sort_order: 1, post_count: 0, status: 'active', managementRevision: 0 }
function fixture() {
  let rows = new Map(), tail = Promise.resolve()
  const store = { identifier: name => name, named: async name => [...rows.values()].filter(row => row.name === name),
    list: async () => [...rows.values()].filter(row => row.status === 'active'), lastSort: async () => 1,
    run(work) {
      const result = tail.then(async () => {
        const next = new Map(rows)
        const value = await work({ read: async id => next.get(id) || null, put: async (id, row) => { next.set(id, row) },
          update: async (id, fields) => { next.set(id, { ...next.get(id), ...fields }) } })
        rows = next; return value
      })
      tail = result.catch(() => {}); return result
    } }
  return { store, rows: () => rows }
}
test('category seeds are deterministic under concurrent retries and failures cannot become seeds', async () => {
  const f = fixture()
  await Promise.all([seedDefaultCategories(f.store), seedDefaultCategories(f.store)])
  assert.equal(f.rows().size, 5)
  assert.equal((await seedDefaultCategories(f.store)).seeded, false)
  await assert.rejects(seedDefaultCategories({ ...f.store, named: async () => { throw Error('offline') } }), /offline/)
  assert.equal(f.rows().size, 5)
})
test('category DTOs strip private fields; banned categories and malformed updates cannot become active', async () => {
  const result = await listActiveCategories({ list: async () => [{ ...base, private_token: 'private' }, { ...base, _id: 'trade', name: '二手交易' }] })
  assert.equal(result.categories.length, 1); assert.equal(JSON.stringify(result).includes('private'), false)
  const f = fixture()
  await assert.rejects(createCategoryRecord(f.store, { name: '二手交易' }), { code: 'INVALID_CATEGORY' })
  await createCategoryRecord(f.store, { name: 'Campus' })
  for (const [fields, code] of [[{ name: '二手交易' }, 'INVALID_CATEGORY'], [{ status: 'oops' }, 'INVALID_INPUT']]) {
    await assert.rejects(updateCategoryRecord(f.store, { category_id: 'Campus', ...fields }), { code })
  }
  await assert.rejects(createCategoryRecord({ ...f.store, lastSort: async () => { throw Error('offline') } }, { name: 'Other' }), /offline/)
  assert.equal(f.rows().size, 1)
})
test('administrative category lists include hidden categories but project away private fields', async () => {
  const result = await listAdminCategories({ listAll: async () => [
    { ...base, private_token: 'private' }, { ...base, _id: 'hidden', name: 'Old', status: 'hidden', _openid: 'private' },
  ] })
  assert.equal(result.categories.length, 2)
  assert.equal(result.categories[1].status, 'hidden')
  assert.equal(JSON.stringify(result).includes('private'), false)
})
