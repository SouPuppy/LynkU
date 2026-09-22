const test = require('node:test')
const assert = require('node:assert/strict')
const { parseCreatePostRequest, parseUpdatePostRequest, parseDraftSave, POST_CONTENT_LIMIT } = require('@lynku/contracts')

test('post creation, editing and drafts preserve the shared 10000 character boundary', () => {
  assert.equal(POST_CONTENT_LIMIT, 10000)
  const fields = { title: '校园', content: '文'.repeat(10000), category_id: '', anonymous: false }
  for (const [parse, input] of [
    [parseCreatePostRequest, { ...fields, request_id: 'request-create' }],
    [parseUpdatePostRequest, { ...fields, post_id: 'post', expected_revision: 1 }],
    [parseDraftSave, { ...fields, request_id: 'request-draft' }],
  ]) {
    assert.equal(parse(input).content.length, 10000)
    assert.throws(() => parse({ ...input, content: input.content + '文' }))
  }
})
