import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManagedCategoryList, parseCategoryChangeReceipt } from '@lynku/contracts'
const category = { _id: 'campus', name: 'Campus', description: '', status: 'active', sort_order: 0, post_count: 3, managementRevision: 1 }
test('managed lists preserve version and hidden rows, strip private fields and reject unmigrated records', () => {
  const items = parseManagedCategoryList({ categories: [{ ...category, status: 'hidden', secret: 'private' }] })
  assert.equal(items[0]!.status, 'hidden'); assert.equal(items[0]!.managementRevision, 1)
  assert.equal(JSON.stringify(items).includes('private'), false)
  assert.throws(() => parseManagedCategoryList({ categories: [{ ...category, managementRevision: undefined }] }))
  assert.throws(() => parseManagedCategoryList({ categories: [category, category] }))
})
test('category receipts require valid request, revision and timestamp', () => {
  const receipt = { requestId: 'category-request-0001', category, appliedAt: '2026-09-22T00:00:00.000Z' }
  assert.deepEqual(parseCategoryChangeReceipt(receipt), receipt)
  for (const invalid of [{ ...receipt, requestId: '' }, { ...receipt, appliedAt: 'invalid' }, { ...receipt, category: { ...category, managementRevision: -1 } }]) {
    assert.throws(() => parseCategoryChangeReceipt(invalid))
  }
})
