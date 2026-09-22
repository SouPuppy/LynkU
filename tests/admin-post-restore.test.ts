import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ModerationFailure, RestoreGovernedPostFailure, restoreGovernedPost, type RestoreGovernedPostTransaction } from '@lynku/server'
import type { RestoreGovernedPostReceipt } from '@lynku/contracts'

const base = {
  _id: 'post-one', _openid: 'author-openid', title: 'Original title', content: 'Original checked body', category_id: 'campus',
  status: 'hidden', revision: 2, governance_case_id: 'case-one',
}
const decision = { _id: 'case-one', targetType: 'post', targetId: 'post-one', status: 'closed', outcome: 'hide_post' }
const request = { requestId: 'restore-request-0001', postId: 'post-one', caseId: 'case-one', expectedRevision: 2, reason: '复核后确认可恢复' }

function fixture(options: { rejected?: boolean; unavailable?: boolean; caseState?: Record<string, unknown>; beforeWrite?: () => void; failAudit?: boolean } = {}) {
  let state = { post: { ...base }, category: { _id: 'campus', status: 'active', post_count: 4 }, case: { ...decision, ...options.caseState }, receipts: new Map<string, { fingerprint: string; result: RestoreGovernedPostReceipt }>(), audits: new Map<string, unknown>() }
  let tail = Promise.resolve(), moderationCalls = 0
  const clone = () => structuredClone(state)
  const store = {
    now: () => '2026-09-22T00:00:00.000Z',
    inspect: async (id: string) => id === state.post._id ? structuredClone(state.post) : null,
    prior: async (requestId: string) => state.receipts.get(requestId) || null,
    moderate: async () => {
      moderationCalls++
      if (options.unavailable) throw new ModerationFailure('MODERATION_UNAVAILABLE')
      return { clean: !options.rejected }
    },
    run: <T>(work: (tx: RestoreGovernedPostTransaction) => Promise<T>) => {
      const task = tail.then(async () => {
        const next = clone()
        const result = await work({
          authorize: async () => {},
          post: async id => id === next.post._id ? next.post : null,
          category: async id => id === next.category._id ? next.category : null,
          case: async id => id === next.case._id ? next.case : null,
          receipt: async requestId => next.receipts.get(requestId) || null,
          updatePost: async (_id, fields) => { options.beforeWrite?.(); next.post = { ...next.post, ...fields } },
          setCategoryCount: async (_id, count) => { next.category.post_count = count },
          record: async (requestId, fingerprint, result, reason) => {
            if (options.failAudit) throw Error('audit unavailable')
            next.receipts.set(requestId, { fingerprint, result })
            next.audits.set(requestId, { reason, result })
          },
        })
        state = next
        return result
      })
      tail = task.then(() => undefined, () => undefined)
      return task
    },
  }
  return { store, state: () => structuredClone(state), moderationCalls: () => moderationCalls }
}

test('governed restoration rechecks moderation, case and category atomically and confirms retries', async () => {
  const f = fixture()
  const [first, duplicate] = await Promise.all([restoreGovernedPost(f.store, request), restoreGovernedPost(f.store, request)])
  assert.deepEqual(first, duplicate)
  assert.equal(first.post.status, 'published')
  assert.equal(f.state().post.revision, 3)
  assert.equal(f.state().category.post_count, 5)
  assert.equal(f.state().audits.size, 1)
  const confirmed = await restoreGovernedPost(f.store, request)
  assert.deepEqual(confirmed, first)
  assert.ok(f.moderationCalls() >= 1)
  await assert.rejects(restoreGovernedPost(f.store, { ...request, reason: 'different reason' }), RestoreGovernedPostFailure)
})

test('restoration refuses failed safety checks, author deletion, reopened appeals, stale versions and audit failures', async () => {
  for (const options of [{ rejected: true }, { unavailable: true }, { caseState: { status: 'open', outcome: null } }]) {
    const f = fixture(options)
    await assert.rejects(restoreGovernedPost(f.store, request))
    assert.equal(f.state().post.status, 'hidden')
    assert.equal(f.state().category.post_count, 4)
  }
  const deleted = fixture()
  deleted.store.inspect = async () => ({ ...base, status: 'deleted' })
  await assert.rejects(restoreGovernedPost(deleted.store, request), RestoreGovernedPostFailure)
  const stale = fixture({ beforeWrite: () => { /* the real transaction sees its own current record below */ } })
  stale.store.inspect = async () => ({ ...base, revision: 2 })
  await assert.rejects(restoreGovernedPost(stale.store, { ...request, expectedRevision: 3 }), RestoreGovernedPostFailure)
  const broken = fixture({ failAudit: true })
  await assert.rejects(restoreGovernedPost(broken.store, request), /audit unavailable/)
  assert.equal(broken.state().post.status, 'hidden')
  assert.equal(broken.state().category.post_count, 4)
})
