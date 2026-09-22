import test from 'node:test'
import assert from 'node:assert/strict'
import { projectOperationTask, readOperationTasks, readOperationTask, AdminOperationFailure } from '../packages/server/src/admin/operations'
import { type OperationQuery } from '../packages/contracts/src/admin-operations'
const now = Date.parse('2026-09-22T00:00:00.000Z')
const task = { _id: 'task', status: 'pending', attempt_count: 2, next_attempt_at: now + 1000, created_at: new Date(now), last_attempt_at: now,
  notification: { to: 'private-recipient', content: 'private-body' }, openid: 'private-owner', last_error: 'DELIVERY_FAILED' }
test('operation projections exclude payloads and redact unrecognized error contents', async () => {
  const value = projectOperationTask({ ...task, last_error: 'private-provider-token' }, 'notifications')
  assert.equal(value.lastError, 'UNCLASSIFIED_ERROR'); assert.equal(JSON.stringify(value).includes('private'), false)
  assert.deepEqual(Object.keys(value).sort(), ['id', 'kind', 'status', 'createdAt', 'attempts', 'retryRevision', 'nextAttemptAt', 'leaseUntil', 'lastAttemptAt', 'deliveredAt', 'lastError'].sort())
  const delivered = projectOperationTask({ ...task, status: 'delivered', delivered_at: new Date(now), lease_until: null }, 'profiles')
  assert.equal(delivered.nextAttemptAt, null); assert.equal(delivered.lastError, 'DELIVERY_FAILED')
  await assert.rejects(readOperationTask({ read: async () => null }, { kind: 'notifications', id: 'absent' }), { code: 'NOT_FOUND' })
  await assert.rejects(readOperationTask({ read: async () => task }, { kind: 'users', id: 'task' }), AdminOperationFailure)
})
test('operation pagination preserves equal-time records and binds collection and status', async () => {
  const rows = Array.from({ length: 53 }, (_, i) => ({ ...task, _id: `task-${100 - i}` }))
  const store = { list: async (query: OperationQuery, take: number) => rows.filter(row => !query.cursor || row._id < query.cursor.id).slice(0, take) }
  // Pad IDs to match lexical database ordering.
  rows.forEach((row, i) => { row._id = `task-${String(100 - i).padStart(3, '0')}` })
  let query: OperationQuery = { kind: 'notifications', status: 'pending', cursor: null, limit: 25 }
  const ids: string[] = []
  do {
    const page = await readOperationTasks(store, query)
    ids.push(...page.items.map(item => item.id))
    if (page.nextCursor) {
      await assert.rejects(readOperationTasks(store, { ...query, kind: 'profiles', cursor: page.nextCursor }), AdminOperationFailure)
      await assert.rejects(readOperationTasks(store, { ...query, status: 'delivered', cursor: page.nextCursor }), AdminOperationFailure)
    }
    query = { ...query, cursor: page.nextCursor }
  } while (query.cursor)
  assert.deepEqual(ids, rows.map(row => row._id)); assert.equal(new Set(ids).size, 53)
})
test('invalid task state and missing lease are not reported as healthy records', async () => {
  assert.throws(() => projectOperationTask({ ...task, status: 'processing' }, 'notifications'), /operation integer/)
  assert.throws(() => projectOperationTask({ ...task, status: 'delivered' }, 'notifications'), /timing/)
  await assert.rejects(readOperationTasks({ list: async () => [task] }, { status: 'delivered' }), /scope mismatch/)
})
