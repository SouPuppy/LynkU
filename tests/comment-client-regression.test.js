const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function runtime() {
  const modules = new Map(), timers = new Map(), navigations = []
  const app = { globalData: { user: null, openid: null } }
  let nextTimer = 0
  const wx = {
    getStorageSync() {}, setStorageSync() {}, removeStorageSync() {},
    navigateTo: args => navigations.push(args.url),
    cloud: { callFunction: async () => { throw new Error('Unexpected cloud call') } },
  }
  const env = {
    wx, console, getApp: () => app,
    setInterval: fn => { timers.set(++nextTimer, fn); return nextTimer },
    clearInterval: id => timers.delete(id),
    Page: value => { env.page = value; value.setData = update => Object.assign(value.data, update) },
    Component: value => { env.component = value },
  }
  function load(relative) {
    const filename = path.resolve(root, relative)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const source = fs.readFileSync(filename, 'utf8')
    const code = filename.endsWith('.ts') ? ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText : source
    vm.runInNewContext(code, {
      ...env, module, exports: module.exports,
      require: spec => {
        if (!spec.startsWith('.')) return require(spec)
        const target = path.resolve(path.dirname(filename), spec)
        // WeChat requires an explicit file; Node's directory/index fallback hides page crashes.
        const found = [target + '.ts', target + '.js'].find(fs.existsSync)
        if (!found) throw new Error(`Missing dependency: ${spec}`)
        return load(found)
      },
    }, { filename })
    return module.exports
  }
  return { env, wx, load, timers, navigations }
}

const comment = {
  _id: 'parent', _openid: 'author-public-id', post_id: 'post', parent_id: null, depth: 0,
  content: 'Parent comment', anonymous: false, is_mine: false, status: 'published',
  created_at: '2026-09-21T00:00:00.000Z', author: { nickname: 'Author', avatar_url: '' },
}
const profile = { profile_version: 0, _openid: 'viewer', verified: true, nickname: 'Viewer', avatar_url: '', role: 'user', email: '' }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('settings, legal, reports and post register with WeChat file-only module resolution', () => {
  for (const name of ['settings', 'legal', 'reports', 'post']) {
    const r = runtime()
    r.load(`apps/miniprogram/pages/${name}/${name}.ts`)
    assert.ok(r.env.page, `${name} must register its page`)
  }
})

test('post detail loads current API data and can retry after a request failure', async () => {
  const r = runtime()
  r.load('apps/miniprogram/pages/post/post.ts')
  const page = r.env.page
  page.setData({ postId: 'post' })
  let fail = true
  r.wx.cloud.callFunction = async ({ name, data }) => {
    assert.equal(name, 'posts')
    assert.equal(data.action, 'get')
    assert.equal(data.post_id, 'post')
    if (fail) throw new Error('Network offline')
    return { result: { data: { post: {
      _id: 'post', title: 'Title', content: 'Body', category_id: '', category: null,
      anonymous: true, is_mine: false, status: 'published', revision: 1,
      view_count: 1, comment_count: 0, author: { nickname: '匿名用户', avatar_url: '' },
      created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z',
    } } } }
  }
  await page.loadPost()
  assert.equal(page.data.state, 'error')
  fail = false
  await page.loadPost()
  assert.equal(page.data.state, 'loaded')
  assert.equal(page.data.post.content, 'Body')
  assert.equal(page.data.post._openid, undefined)
  page.onUnload()
})

test('real-name comment and reply author links use the public DTO identity field', () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set(profile)
  const { parseCommentView } = r.load('apps/miniprogram/generated/contracts/index.ts')
  r.load('apps/miniprogram/components/comment-item/comment-item.ts')
  for (const raw of [comment, { ...comment, _id: 'reply', parent_id: 'parent', depth: 1 }]) {
    const view = parseCommentView(raw)
    assert.equal(view.author._openid, undefined)
    r.env.component.methods.onAuthorTap({ currentTarget: { dataset: {
      authorId: view._openid, anonymous: view.anonymous, commentId: view._id, isMine: view.is_mine,
    } } })
  }
  assert.deepEqual(r.navigations, ['/pages/user/user?openid=author-public-id', '/pages/user/user?openid=author-public-id'])
})

test('anonymous comment author links keep source isolation and deleted authors cannot navigate', () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set(profile)
  const { parseCommentView } = r.load('apps/miniprogram/generated/contracts/index.ts')
  r.load('apps/miniprogram/components/comment-item/comment-item.ts')
  for (const raw of [
    { ...comment, anonymous: true },
    { ...comment, anonymous: true, is_mine: true },
    { ...comment, status: 'deleted' },
  ]) {
    const view = parseCommentView(raw)
    r.env.component.methods.onAuthorTap({ currentTarget: { dataset: {
      authorId: view._openid, anonymous: view.anonymous, commentId: view._id, isMine: view.is_mine,
    } } })
  }
  assert.equal(r.navigations.length, 1)
  assert.match(r.navigations[0], /anon_type=comment&anon_id=parent/)
  assert.equal(r.navigations[0].includes(comment._openid), false)
})

test('comment polling retains a deleted parent placeholder and its published replies', async () => {
  const r = runtime()
  r.load('apps/miniprogram/services/session.ts').set(profile)
  const { parseCommentView } = r.load('apps/miniprogram/generated/contracts/index.ts')
  const { buildCommentTree } = r.load('apps/miniprogram/services/comments.ts')
  r.load('apps/miniprogram/pages/post/post.ts')
  const page = r.env.page
  const reply = { ...comment, _id: 'reply', content: 'Still visible', parent_id: 'parent', depth: 1 }
  page.setData({ postId: 'post', comments: buildCommentTree([parseCommentView(comment), parseCommentView(reply)]) })
  r.wx.cloud.callFunction = async ({ data }) => ({ result: { data: data.action === 'list' ? {
    items: [comment, reply], total: 2, hasMore: false, nextCursor: null,
    syncCursor: { version: 1, post_id: 'post', sequence: 0 },
  } : {
    changes: data.cursor.sequence === 0 ? [{ comment_id: 'parent', sequence: 1, type: 'deleted', comment: { ...comment, status: 'deleted' } }] : [],
    next_cursor: { version: 1, post_id: 'post', sequence: 1 }, has_more: false,
  } } })
  await page.loadComments()
  await tick()
  assert.equal(page.data.comments.length, 1)
  assert.equal(page.data.comments[0].status, 'deleted')
  assert.equal(page.data.comments[0].content, '')
  assert.equal(page.data.comments[0]._openid, undefined)
  assert.equal(page.data.comments[0].replies.length, 1)
  assert.equal(page.data.comments[0].replies[0].content, 'Still visible')
  await [...r.timers.values()][0]()
  assert.equal(page.data.comments[0].replies.length, 1)
  page.onUnload()
  assert.equal(r.timers.size, 0)
})
