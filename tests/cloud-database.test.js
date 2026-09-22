const test = require('node:test')
const assert = require('node:assert/strict')
const { connectDatabase } = require('../apps/cloudfunctions/common/database.ts')

function fixture(response) {
  const doc = { get: async () => response }
  const query = { get: async () => response, count: async () => response, doc: () => doc }
  const raw = { collection: () => query, runTransaction: work => work({ collection: () => query }) }
  return connectDatabase(raw)
}

test('database boundary distinguishes explicit absence from malformed or failed reads', async () => {
  assert.equal((await fixture({ data: null }).collection('drafts').doc('id').get()).data, null)
  for (const response of [undefined, null, {}, { data: [] }, { data: 'invalid' }]) {
    const db = fixture(response)
    await assert.rejects(db.collection('drafts').doc('id').get())
    await assert.rejects(db.runTransaction(tx => tx.collection('drafts').doc('id').get()))
  }
  const row = { _id: 'id', content: 'private' }
  assert.deepEqual((await fixture({ data: row }).collection('drafts').doc('id').get()).data, row)
})

test('database lists and counters reject malformed SDK envelopes instead of becoming empty', async () => {
  for (const response of [{}, { data: null }, { data: {} }, { data: [null] }, { data: [1] }]) {
    await assert.rejects(fixture(response).collection('categories').get())
  }
  for (const total of [-1, '1', NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(fixture({ total }).collection('drafts').count())
  }
  assert.deepEqual(await fixture({ data: [] }).collection('categories').get(), { data: [] })
  assert.deepEqual(await fixture({ total: 0 }).collection('drafts').count(), { total: 0 })
})
