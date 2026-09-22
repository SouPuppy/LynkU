import test from 'node:test'
import assert from 'node:assert/strict'
import { readAdminOverview } from '@lynku/server'
test('overview isolates unavailable metrics and never queries forbidden counters', async () => {
  const calls: string[] = []
  const result = await readAdminOverview({ now: () => '2026-09-22T10:00:00.000Z', count: async key => {
    calls.push(key)
    if (key === 'users') throw Error('Database unavailable')
    return key === 'posts' ? 0 : 7
  } }, ['content:read', 'users:read'])
  assert.deepEqual(result.metrics.users, { value: null, state: 'unavailable' })
  assert.deepEqual(result.metrics.posts, { value: 0, state: 'available' })
  assert.deepEqual(result.metrics.openCases, { value: null, state: 'forbidden' })
  assert.equal(calls.includes('openCases'), false)
})
test('invalid database counts cannot appear as valid metrics', async () => {
  for (const value of [-1, NaN, 1.5, Infinity]) {
    const result = await readAdminOverview({ now: () => '2026-09-22T10:00:00.000Z', count: async () => value }, ['content:read'])
    assert.deepEqual(result.metrics.posts, { value: null, state: 'unavailable' })
  }
})
