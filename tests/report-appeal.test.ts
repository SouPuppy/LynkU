import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appealOwnReport, CaseManagementFailure, projectCaseDetail } from '@lynku/server'
test('only the reporter can appeal, reopening preserves the original decision and strips private receipt fields', async () => {
  let row: Record<string, unknown> = { _id: 'case-1', reporterAccountId: 'reporter', targetType: 'post', targetId: 'post-1', reasonCode: 'spam', statement: 'original',
    status: 'closed', caseVersion: 2, createdAt: '2026-09-21T00:00:00.000Z', outcome: 'no_violation', resolution: 'original reason' }
  let audits = 0
  const store: Parameters<typeof appealOwnReport>[0] = { now: () => '2026-09-22T00:00:00.000Z', identifier: (...parts) => JSON.stringify(parts), run: work => work({
    authorize: async () => {}, read: async () => row, update: async (_id, fields) => { row = { ...row, ...fields } }, audit: async () => { audits++ },
  }) }
  const request = { id: 'case-1', expectedVersion: 2, requestId: 'appeal-request-0001', statement: 'please reconsider' }
  await assert.rejects(appealOwnReport(store, 'intruder', request), CaseManagementFailure)
  assert.equal(audits, 0)
  const receipt = await appealOwnReport(store, 'reporter', request)
  assert.equal(row.status, 'open'); assert.equal(row.caseVersion, 3)
  const detail = projectCaseDetail(row)
  assert.equal(detail.appeal?.previousResolution, 'original reason')
  assert.equal(detail.appeal?.statement, 'please reconsider')
  assert.ok(!JSON.stringify(detail).includes('appeal-request-0001'))
  assert.ok(!('reporterAccountId' in detail))
  row = { ...row, status: 'closed', caseVersion: 4, outcome: 'no_violation', resolution: 'reviewed reason' }
  assert.deepEqual(await appealOwnReport(store, 'reporter', request), receipt)
  assert.equal(audits, 1); assert.equal(row.status, 'closed')
  await assert.rejects(appealOwnReport(store, 'reporter', { ...request, requestId: 'appeal-request-0002' }), CaseManagementFailure)
})
