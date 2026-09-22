const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

function filesBelow(relative, extension) {
  const result = []
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (entry.name.endsWith(extension)) result.push(fullPath)
    }
  }
  visit(path.join(root, relative))
  return result
}

test('client cannot directly read private collections', () => {
  const sources = filesBelow('apps/miniprogram', '.ts').map(file => fs.readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(sources, /collection\(['"](?:posts|comments|messages|notifications|users|drafts|rate_limits)['"]\)/)
})

test('notification creation is not a public message action', () => {
  const source = read('apps/cloudfunctions/messages/index.ts')
  assert.doesNotMatch(source, /case ['"]createNotification['"]/)
  assert.match(read('apps/cloudfunctions/comments/index.ts'), /createNotification\(/)
})

test('comment notifications show comment text and use deterministic ids', () => {
  const commentCloud = read('apps/cloudfunctions/comments/index.ts')
  assert.match(read('packages/server/src/notifications/comment-events.ts'), /identifier\(['"]notification['"]/)
  assert.doesNotMatch(commentCloud, /createCollection\(/)
  assert.doesNotMatch(commentCloud, /['"]target\.comment_id['"]/)

  const card = read('apps/miniprogram/components/notification-card/notification-card.ts')
  assert.match(card, /commentPreview \|\| postTitle/)
  assert.doesNotMatch(card, /post_title \|\| target\.comment_preview/)
})

test('notification reads are side-effect free', () => {
  const source = read('apps/cloudfunctions/messages/index.ts')
  const notificationReads = source.slice(source.indexOf('async function listNotifications'), source.indexOf('async function markNotificationsRead'))
  assert.doesNotMatch(source, /backfillCommentNotifications/)
  assert.doesNotMatch(notificationReads, /collection\(['"]posts['"]\)/)
  assert.doesNotMatch(notificationReads, /collection\(['"]comments['"]\)/)
  assert.match(read('apps/cloudfunctions/comments/index.ts'), /createNotification\(/)
})

test('anonymous identity uses the shared anonymous avatar', () => {
  // Server response behavior is covered by comment-view.test.js.
  assert.match(read('apps/miniprogram/components/avatar/avatar.ts'), /\/assets\/anonymous\.png/)
  assert.match(read('apps/miniprogram/pages/profile/profile.wxml'), /anonymousMode \? anonymousName : user\.nickname/)
  assert.match(read('apps/miniprogram/pages/profile/profile.wxml'), /anonymous="\{\{anonymousMode\}\}"/)
})

test('anonymous chat uses server-resolved targets without exposing the real peer id', () => {

  const chatService = read('apps/miniprogram/services/messages.ts')
  assert.match(chatService, /anonymous_target: anonymousTargetPayload/)
  assert.match(chatService, /return target \|\| undefined/)

  const postPage = read('apps/miniprogram/pages/post/post.ts')
  assert.match(postPage, /anon_type=post/)

  const commentItem = read('apps/miniprogram/components/comment-item/comment-item.ts')
  assert.match(commentItem, /anon_type=comment/)
})

test('email verification is server-owned and gates write actions', () => {
  const usersCloud = read('apps/cloudfunctions/users/index.ts')
  assert.match(usersCloud, /MAILGUN_API_KEY/)
  assert.match(usersCloud, /https\.request/)
  assert.match(usersCloud, /MAILGUN_TIMEOUT_MS/)
  assert.doesNotMatch(usersCloud, /mailgun\.client/)
  assert.match(usersCloud, /case ['"]sendEmailCode['"]/)
  assert.match(usersCloud, /case ['"]verifyEmailCode['"]/)
  assert.doesNotMatch(usersCloud, /createCollection/)
  assert.match(require('@lynku/server').verificationMail('student@nottingham.edu.cn', '012345').text, /垃圾邮件/)

  const usersPackage = read('apps/cloudfunctions/users/package.json')
  assert.doesNotMatch(usersPackage, /mailgun\.js|form-data/)

  const usersConfig = read('apps/cloudfunctions/users/config.json')
  assert.match(usersConfig, /"timeout":\s*(1[0-9]|[2-9][0-9])/)

  const developmentGuide = read('docs/DEVELOPMENT.md')
  assert.match(developmentGuide, /email_verifications/)

  for (const file of [
    'apps/cloudfunctions/posts/index.ts',
    'apps/cloudfunctions/comments/index.ts',
    'apps/cloudfunctions/messages/index.ts',
    'apps/cloudfunctions/drafts/index.ts',
  ]) {
    assert.match(read(file), /authorizeAction\(db, openid/, file)
  }
  const common = read('apps/cloudfunctions/common/index.ts')
  assert.match(common, /messages:[\s\S]*listConversations: 'verified'/)
  assert.match(common, /drafts: Object\.freeze\(\{ save: 'verified'/)
})

test('post creation accepts a caller-stable idempotency key', () => {
  const posts = read('packages/server/src/content/create-post.ts')
  const service = read('apps/miniprogram/services/posts.ts')
  assert.match(posts, /request_id/)
  assert.match(posts, /identifier\(['"]post:create['"]/)
  assert.match(posts, /request_fingerprint/)
  assert.match(posts, /CONFLICT/)
  assert.match(service, /requestId\?: string/)
  assert.match(service, /request_id: requestId/)
})

// Comment creation, change sequences and retry side effects are exercised by
// comment-create-entry.test.js and guest-session.test.js, not source regexes.

test('message idempotency keys bind to the original payload', () => {
  const messages = read('apps/cloudfunctions/messages/index.ts')
  const chat = read('apps/miniprogram/subpkg-chat/pages/chat/chat.ts')
  const send = read('packages/server/src/messaging/application/send-message.ts')
  assert.match(send, /message:payload/)
  assert.match(messages, /相同消息ID不能用于不同内容/)
  assert.match(send, /request_fingerprint/)
  assert.match(chat, /_pendingMessageId/)
  assert.match(chat, /_pendingMessageText/)
})


test('public profile DTO does not expose account verification state', () => {
  const users = read('apps/cloudfunctions/users/index.ts')
  const publicProfile = users.slice(users.indexOf('async function getPublicProfile'))
  assert.doesNotMatch(publicProfile, /verified: !!user\.verified/)
  assert.doesNotMatch(publicProfile, /role: user\.role/)
  const types = read('apps/miniprogram/typings/cloudbase.d.ts')
  assert.match(types, /export type ISelfProfile/)
})

test('production deployment includes drafts and excludes destructive or retired functions', () => {
  const names = JSON.parse(read('cloudbaserc.json')).functions.map(entry => entry.name)
  assert.ok(names.includes('drafts'))
  assert.ok(!names.includes('clear-db') && !names.includes('login'))
  assert.equal(fs.existsSync(path.join(root, 'apps', 'cloudfunctions', 'clear-db')), false)
})

test('WXML contains no calls to TypeScript instance methods', () => {
  for (const file of filesBelow('apps/miniprogram', '.wxml')) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\{\{[^}]*[A-Za-z_$][A-Za-z0-9_$]*\(/, file)
  }
})

test('display components validate framework object properties before treating them as DTOs', () => {
  const commentItem = read('apps/miniprogram/components/comment-item/comment-item.ts')
  const notificationCard = read('apps/miniprogram/components/notification-card/notification-card.ts')
  assert.match(commentItem, /function toCommentThread/)
  assert.match(notificationCard, /function toNotification/)
  assert.doesNotMatch(commentItem, /Record<string, any>/)
  assert.doesNotMatch(notificationCard, /Record<string, any>/)
})

test('cloud utilities have one source and are bundled for independent deployment', () => {
  const manifest = JSON.parse(read('dist/cloudfunctions/manifest.json'))
  for (const name of ['users', 'posts', 'comments', 'messages', 'categories', 'drafts']) {
    assert.equal(fs.existsSync(path.join(root, 'apps/cloudfunctions', name, 'utils.js')), false, name)
    assert.ok(manifest.artifacts.find(artifact => artifact.name === name).inputs.includes('apps/cloudfunctions/common/index.ts'), name)
  }
})

test('ticket index covers every ticket file with the same status', () => {
  const index = JSON.parse(read('docs/tickets/.index.json'))
  const files = fs.readdirSync(path.join(root, 'docs', 'tickets'))
    .filter(file => /^\w+-\d+\.md$/.test(file))
  assert.equal(files.length, Object.keys(index.tickets).length)
  for (const file of files) {
    const id = file.slice(0, -3)
    const source = read(`docs/tickets/${file}`)
    const match = source.match(/^status:\s*(.+)$/m) || source.match(/\| Status \| ([^|]+) \|/)
    assert.ok(match, id)
    assert.equal(match[1].trim().toLowerCase(), index.tickets[id].status, id)
  }
})
