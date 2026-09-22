const test = require('node:test')
const assert = require('node:assert/strict')
const { require: loadTs } = require('tsx/cjs/api')
const { applyOperationRetry } = loadTs('../apps/cloudfunctions/admin/operation-retry.ts', __filename)
const { ownsOutboxLease } = require('@lynku/server')
function fixture(options = {}) {
  let data = new Map([
    ['admin_members/owner', { _id: 'owner', web_uid: 'trusted', account_id: 'platform-owner:trusted', kind: 'platform-owner', role: 'owner', status: 'active', version: 1 }],
    ['users/user', { _id: 'user', _openid: 'recipient', profile_version: 2 }],
    ['account_lifecycle/lifecycle', { _id: 'lifecycle', currentAccountId: 'user', state: options.closed ? 'closing' : 'active' }],
    ['profile_outbox/profile', { _id: 'profile', openid: 'recipient', profile_version: 2, status: 'pending', attempt_count: 1, next_attempt_at: Date.now() + 60000, last_error: 'DELIVERY_FAILED' }],
    ['posts/post', { _id: 'post', _openid: 'recipient', status: options.deleted ? 'deleted' : 'published' }],
    ['comments/comment', { _id: 'comment', post_id: 'post', _openid: 'author', anonymous: true, status: 'published' }],
    ['notification_outbox/job', { _id: 'job', status: options.processing ? 'processing' : 'pending', attempt_count: 1, next_attempt_at: Date.now() + 60000, lease_until: options.liveLease ? Date.now() + 60000 : 0, last_error: 'DELIVERY_FAILED', notification: { type: 'comment', to: 'recipient', actor: { _openid: 'author' }, anonymous: true, target: { post_id: 'post', comment_id: 'comment' } } }],
  ])
  let tail = Promise.resolve()
  function collection(source, name) {
    return {
      where: query => ({ limit: () => ({ get: async () => ({ data: [...source.entries()].filter(([key, value]) => key.startsWith(`${name}/`) && Object.entries(query).every(([field, value]) => source.get(key)[field] === value)).map(([, value]) => value) }) }) }),
      doc: id => { const key = `${name}/${id}`; return {
        get: async () => ({ data: source.get(key) ?? null }),
        update: async ({ data: fields }) => { source.set(key, { ...source.get(key), ...fields }) },
        set: async ({ data: fields }) => { if (options.failAudit && name === 'audit_events') throw Error('audit offline'); source.set(key, { _id: id, ...fields }) },
      } },
    }
  }
  const db = { collection: name => collection(data, name), runTransaction: work => {
    const run = tail.then(async () => { const next = new Map(data); if (options.revoked) next.set('admin_members/owner', { ...next.get('admin_members/owner'), status: 'revoked' }); const result = await work({ collection: name => collection(next, name) }); data = next; return result })
    tail = run.catch(() => {}); return run
  } }
  return { db, data: () => data }
}
const request = { kind: 'notifications', id: 'job', expectedStatus: 'pending', expectedAttempts: 1, expectedRetryRevision: 0, requestId: 'retry-operation-0001', reason: '确认服务恢复后重试' }
test('retry adapter schedules original task with one atomic receipt under concurrent repeated requests', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([applyOperationRetry(f.db, 'trusted', request), applyOperationRetry(f.db, 'trusted', request)])
  assert.deepEqual(a, b); assert.equal(a.retryRevision, 1)
  const job = f.data().get('notification_outbox/job')
  assert.equal(job.attempt_count, 1); assert.equal(job.retry_revision, 1)
  assert.equal([...f.data().keys()].filter(key => key.startsWith('notification_outbox/')).length, 1)
  assert.equal([...f.data().keys()].filter(key => key.startsWith('audit_events/')).length, 1)
  await assert.rejects(applyOperationRetry(f.db, 'trusted', { ...request, requestId: 'retry-operation-0002' }), { code: 'CONFLICT' })
  await assert.rejects(applyOperationRetry(f.db, 'trusted', { ...request, reason: 'different' }), { code: 'CONFLICT' })
})
test('retry rechecks authority and source, preserves active leases, and rolls back on audit failure', async () => {
  for (const options of [{ revoked: true }, { closed: true }, { deleted: true }, { processing: true, liveLease: true }, { failAudit: true }]) {
    const f = fixture(options)
    await assert.rejects(applyOperationRetry(f.db, 'trusted', { ...request, expectedStatus: options.processing ? 'processing' : 'pending' }))
    assert.equal(f.data().get('notification_outbox/job').retry_revision, undefined)
    assert.equal([...f.data().keys()].filter(key => key.startsWith('admin_operation_receipts/')).length, 0)
  }
  const expired = fixture({ processing: true })
  await applyOperationRetry(expired.db, 'trusted', { ...request, expectedStatus: 'processing' })
  assert.equal(ownsOutboxLease(expired.data().get('notification_outbox/job'), 1), false)
})
test('profile retries reuse the original projection event and reject closing source accounts', async () => {
  const f = fixture(), input = { ...request, kind: 'profiles', id: 'profile' }
  const result = await applyOperationRetry(f.db, 'trusted', input)
  assert.equal(result.kind, 'profiles'); assert.equal(result.retryRevision, 1)
  assert.equal(f.data().get('profile_outbox/profile').profile_version, 2)
  const closed = fixture({ closed: true })
  await assert.rejects(applyOperationRetry(closed.db, 'trusted', input), { code: 'CONFLICT' })
})
