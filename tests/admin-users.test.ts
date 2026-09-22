import test from 'node:test'
import assert from 'node:assert/strict'
import { readAdminUsers, AdminUserInputFailure, projectAdminUserDetail } from '@lynku/server'
import { adminUserPrecedes, parseAdminUserDetail, parseAdminUserPage } from '@lynku/contracts'

const records = Array.from({ length: 53 }, (_, index) => ({ _id: String(100 - index), nickname: 'Campus User', verified: true, email: 'private@nottingham.edu.cn', role: 'user', created_at: new Date('2026-09-22T00:00:00.000Z'), _openid: 'private-wechat' }))
test('admin users traverse same-time records without duplicates and expose only safe summaries', async () => {
  const store = { list: async (query: Parameters<Parameters<typeof readAdminUsers>[0]['list']>[0], take: number) => records.filter(row => !query.cursor || adminUserPrecedes(query.cursor, { id: row._id, createdAt: row.created_at.toISOString() })).slice(0, take) }
  // Database ID ordering is lexical, including IDs of different lengths.
  records.sort((a, b) => a._id > b._id ? -1 : a._id < b._id ? 1 : 0)
  let page = await readAdminUsers(store, { verification: 'verified', limit: 20 })
  const ids = page.items.map(user => user.id)
  assert.equal(page.items[0]!.email, 'pr***te@nottingham.edu.cn')
  assert.equal(JSON.stringify(page).includes('private-wechat'), false)
  assert.equal(JSON.stringify(page).includes('private@'), false)
  while (page.nextCursor) {
    page = await readAdminUsers(store, { verification: 'verified', limit: 20, cursor: page.nextCursor })
    ids.push(...page.items.map(user => user.id))
  }
  assert.equal(ids.length, 53); assert.equal(new Set(ids).size, 53)
})
test('admin users reject cursor reuse with another filter before reading', async () => {
  const first = await readAdminUsers({ list: async () => records.slice(0, 2) }, { limit: 1 })
  let called = false
  await assert.rejects(readAdminUsers({ list: async () => { called = true; return [] } }, { verification: 'guest', cursor: first.nextCursor }), AdminUserInputFailure)
  assert.equal(called, false)
})
test('admin users reject wrong database scope, broken verification and malformed pages', async () => {
  await assert.rejects(readAdminUsers({ list: async () => records.slice(0, 1) }, { verification: 'guest' }))
  await assert.rejects(readAdminUsers({ list: async () => [{ ...records[0], verified: 'true' }] }, {}))
  assert.throws(() => parseAdminUserPage({ items: [], nextCursor: { id: 'x', scope: '', createdAt: '2026-09-22T00:00:00.000Z' } }))
})
test('selected user detail exposes the school address without exposing OpenID or accepting malformed email', () => {
  const detail = projectAdminUserDetail(records[0]!)
  assert.equal(detail.email, 'pr***te@nottingham.edu.cn')
  assert.equal(detail.contactEmail, 'private@nottingham.edu.cn')
  assert.equal(JSON.stringify(detail).includes('private-wechat'), false)
  assert.throws(() => projectAdminUserDetail({ ...records[0], email: 'not an email' }))
  assert.throws(() => parseAdminUserDetail({ ...detail, contactEmail: 'not an email' }))
})
