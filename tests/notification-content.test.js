const assert = require('node:assert/strict')
const test = require('node:test')
const { refreshNotificationContent } = require('@lynku/server')
const notification = { _id: 'n1', type: 'comment', anonymous: false, actor: { _openid: 'owner', nickname: 'Before' },
  target: { post_id: 'p1', comment_id: 'c1', post_title: 'OLD TITLE', comment_preview: 'OLD BODY' } }
const post = { _id: 'p1', title: 'Current title', status: 'published' }
const comment = { _id: 'c1', post_id: 'p1', content: 'Current body', status: 'published', anonymous: false }

test('notifications use current content and conceal removed, moderated, or missing sources', async () => {
  for (const status of ['deleted', 'flagged', 'hidden', 'missing']) {
    for (const which of ['post', 'comment']) {
      const port = { contentSources: async () => ({
        posts: which !== 'post' ? [post] : status === 'missing' ? [] : [{ ...post, status }],
        comments: which !== 'comment' ? [comment] : status === 'missing' ? [] : [{ ...comment, status }],
      }) }
      const [result] = await refreshNotificationContent(port, [notification])
      assert.equal(result.target.comment_preview, '')
      assert.equal(result.target.post_title, '内容已不可用')
      assert.equal(result.actor._openid, undefined)
      assert.equal(JSON.stringify(result).includes('OLD'), false)
    }
  }
  const [result] = await refreshNotificationContent({ contentSources: async () => ({ posts: [post], comments: [{ ...comment, anonymous: true }] }) }, [notification])
  assert.equal(result.target.post_title, post.title)
  assert.equal(result.target.comment_preview, comment.content)
  assert.equal(result.anonymous, true)
})

test('notification source lookups are batched, bounded and fail closed on query or scope errors', async () => {
  let calls = 0
  await refreshNotificationContent({ contentSources: async (posts, comments) => {
    calls++; assert.deepEqual(posts, ['p1']); assert.deepEqual(comments, ['c1'])
    return { posts: [post], comments: [comment] }
  } }, [notification, { ...notification, _id: 'n2' }])
  assert.equal(calls, 1)
  await assert.rejects(refreshNotificationContent({ contentSources: async () => { throw Error('outage') } }, [notification]), /outage/)
  await assert.rejects(refreshNotificationContent({ contentSources: async () => ({ posts: [{ ...post, _id: 'foreign' }], comments: [] }) }, [notification]), /scope/)
})
