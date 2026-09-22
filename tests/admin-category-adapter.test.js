const test = require('node:test')
const assert = require('node:assert/strict')
const { require: loadTs } = require('tsx/cjs/api')
const { applyCategoryChange } = loadTs('../apps/cloudfunctions/admin/category-change.ts', __filename)
const { applyCaseDecision } = loadTs('../apps/cloudfunctions/admin/case-decision.ts', __filename)
const { readGovernanceComment } = require('@lynku/server')
const { stableDocumentId } = loadTs('../apps/cloudfunctions/common/index.ts', __filename)
const category = { _id: 'campus', name: 'Campus', description: '', status: 'active', sort_order: 1, post_count: 4, managementRevision: 0 }
const input = { requestId: 'category-operation-0001', category: { ...category, status: 'hidden' }, reason: '暂时停用' }
function fixture(revokeAtTransaction = false, failAudit = false) {
  let data = new Map([
    ['admin_members/owner', { _id: 'owner', web_uid: 'trusted', account_id: 'platform-owner:trusted', kind: 'platform-owner', role: 'owner', status: 'active', version: 1 }],
    ['categories/campus', category],
    ['posts/post1', { _id: 'post1', status: 'published', category_id: 'campus', revision: 1, comment_count: 1 }],
    ['comments/comment1', { _id: 'comment1', post_id: 'post1', _openid: 'private-author', status: 'published', content: 'reported content', anonymous: true, author: {}, depth: 0, parent_id: null, created_at: new Date('2026-09-22T00:00:00.000Z') }],
    ['comment_counters/post1', { post_id: 'post1', sequence: 1 }],
    ['governance_cases/comment-case', { _id: 'comment-case', status: 'open', caseVersion: 1, targetType: 'comment', targetId: 'comment1', reasonCode: 'SPAM', statement: '', createdAt: '2026-09-22T00:00:00.000Z' }],
    ['governance_cases/case1', { _id: 'case1', status: 'open', caseVersion: 1, targetType: 'post', targetId: 'post1', reasonCode: 'SPAM', statement: '', createdAt: '2026-09-22T00:00:00.000Z' }],
  ])
  const reads = []
  const db = {
    collection: name => ({ where: query => ({ limit: () => ({ get: async () => ({ data: [...data.entries()].filter(([key, value]) => key.startsWith(`${name}/`) && Object.entries(query).every(([field, expected]) => value[field] === expected)).map(([, value]) => value) }) }) }) }),
    runTransaction: async work => {
      const next = new Map(data)
      if (revokeAtTransaction) next.set('admin_members/owner', { ...next.get('admin_members/owner'), status: 'revoked' })
      const result = await work({ collection: name => ({ doc: id => {
        const key = `${name}/${id}`
        return { get: async () => { reads.push(key); return { data: next.get(key) ?? null } },
          update: async ({ data: fields }) => { next.set(key, { ...next.get(key), ...fields }) },
          set: async ({ data: fields }) => { if (failAudit && name === 'audit_events') throw Error('audit offline'); next.set(key, { _id: id, ...fields }) },
        }
      } }) })
      data = next; return result
    },
  }
  return { db, reads, data: () => data }
}
test('comment disposition removes content and atomically advances counts and deletion stream', async () => {
  const f = fixture()
  const preview = await readGovernanceComment({ read: async id => f.data().get(`comments/${id}`), post: async id => f.data().get(`posts/${id}`), identifier: stableDocumentId }, 'comment1')
  assert.equal(JSON.stringify(preview).includes('private-author'), false)
  const request = { id: 'comment-case', requestId: 'comment-disposition-001', expectedVersion: 1, targetToken: preview.versionToken, outcome: 'remove_comment', reason: '移除违规正文' }
  await applyCaseDecision(f.db, 'trusted', request)
  await applyCaseDecision(f.db, 'trusted', request)
  assert.equal(f.data().get('comments/comment1').content, '')
  assert.equal(f.data().get('posts/post1').comment_count, 0)
  assert.equal(f.data().get('comment_counters/post1').sequence, 2)
  assert.equal([...f.data().keys()].filter(key => key.startsWith('comment_changes/')).length, 1)
  const broken = fixture(false, true)
  await assert.rejects(applyCaseDecision(broken.db, 'trusted', request), /audit offline/)
  assert.equal(broken.data().get('comments/comment1').status, 'published')
  assert.equal(broken.data().get('posts/post1').comment_count, 1)
  assert.equal(broken.data().get('comment_counters/post1').sequence, 1)
})
test('case takedown commits post, count, case and receipt together and repeated request does not decrement twice', async () => {
  const request = { id: 'case1', requestId: 'case-operation-0001', expectedVersion: 1, targetRevision: 1, outcome: 'hide_post', reason: '内容违反社区规范' }
  const f = fixture()
  const result = await applyCaseDecision(f.db, 'trusted', request)
  assert.equal(result.outcome, 'hide_post')
  assert.equal(f.data().get('posts/post1').status, 'hidden')
  assert.equal(f.data().get('categories/campus').post_count, 3)
  assert.equal(f.data().get('governance_cases/case1').status, 'closed')
  await applyCaseDecision(f.db, 'trusted', request)
  assert.equal(f.data().get('categories/campus').post_count, 3)
  const broken = fixture(false, true)
  await assert.rejects(applyCaseDecision(broken.db, 'trusted', request), /audit offline/)
  assert.equal(broken.data().get('posts/post1').status, 'published')
  assert.equal(broken.data().get('categories/campus').post_count, 4)
  assert.equal(broken.data().get('governance_cases/case1').status, 'open')
})
test('category adapter rechecks revocation inside the write transaction', async () => {
  const f = fixture(true)
  await assert.rejects(applyCategoryChange(f.db, 'trusted', input), { code: 'FORBIDDEN' })
  assert.ok(f.reads.includes('admin_members/owner'))
  assert.equal(f.data().get('categories/campus').status, 'active')
})
test('category adapter scopes receipts to signed caller and writes one audit with trusted actor', async () => {
  const f = fixture()
  const a = await applyCategoryChange(f.db, 'trusted', { ...input, actor: 'forged' })
  const b = await applyCategoryChange(f.db, 'trusted', input)
  assert.deepEqual(a, b)
  const audits = [...f.data()].filter(([key]) => key.startsWith('audit_events/'))
  assert.equal(audits.length, 1)
  assert.equal(audits[0][1].actor, 'platform-owner:trusted')
  assert.equal(audits[0][1].target, 'campus')
  assert.equal(f.data().get('categories/campus').managementRevision, 1)
  await assert.rejects(applyCategoryChange(f.db, 'unbound', input), { code: 'FORBIDDEN' })
})
