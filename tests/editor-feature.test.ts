import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { EditorController, initialEditorState, parseEditorRoute } from '../apps/miniprogram/features/editor/index'
import type { EditorPorts, EditorRoute, EditorEvent, EditorState, EditorObserver, EditorSession } from '../apps/miniprogram/features/editor/index'
import type { EditorRecovery } from '../apps/miniprogram/features/editor/recovery'
import { parsePostMutationReceipt, POST_CONTENT_LIMIT } from '../apps/miniprogram/generated/contracts/index'
import type { Draft, PostMutationReceipt, SaveDraftRequest } from '../apps/miniprogram/generated/contracts/index'

const date = '2026-09-21T00:00:00.000Z'
const receipt: PostMutationReceipt = { post: { _id: 'post-one', revision: 1, status: 'published' }, flagged: false, status: 'created' }
const createRoute: EditorRoute = { mode: 'create', postId: '', draftId: '' }
function draft(request: SaveDraftRequest, revision = 1): Draft {
  return { _id: 'draft-one', title: request.title, content: request.content, category_id: request.category_id,
    anonymous: request.anonymous, revision, created_at: date, updated_at: date }
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred is not ready') }
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}
function fixture(route: EditorRoute = createRoute) {
  const storage = new Map<string, EditorRecovery>()
  const events: EditorEvent[] = []
  const states: EditorState[] = []
  const listeners = new Set<() => void>()
  const scheduled = new Set<() => void>()
  const requests: SaveDraftRequest[] = []
  const cleanups: { id: string; revision: number }[] = []
  let session: EditorSession = { owner: 'alice', revision: 1, verified: true }
  let nextId = 0, anonymous = false
  const ports: EditorPorts = {
    session: { current: () => session, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    content: {
      categories: async () => [{ _id: 'category', name: 'Topic' }],
      post: async () => ({ title: 'old post', content: 'body', category_id: '', anonymous: false, revision: 7 }),
      drafts: async () => [draft({ title: 'saved draft', content: 'body', category_id: '', anonymous: false })],
      saveDraft: async request => { requests.push({ ...request }); return draft(request, request.expected_revision ? request.expected_revision + 1 : 1) },
      create: async () => receipt, update: async () => receipt,
      enqueueCleanup: (id, revision) => { cleanups.push({ id, revision }) }, flushCleanup: async () => {},
    },
    recovery: { read: owner => storage.get(owner), write: (owner, value) => { storage.set(owner, structuredClone(value)) },
      remove: owner => { storage.delete(owner) } },
    anonymous: { get: () => anonymous, set: value => { anonymous = value } },
    requestId: () => `request-${++nextId}`,
    schedule: (_delay, action) => { scheduled.add(action); return () => { scheduled.delete(action) } },
  }
  const observer: EditorObserver = { state: state => { states.push(state) }, event: event => { events.push(event) } }
  const make = (nextRoute = route, nextObserver = observer) => new EditorController(nextRoute, ports, nextObserver)
  const editor = make()
  return { editor, make, ports, storage, events, states, scheduled, requests, cleanups, listeners,
    switchAccount(owner: string | null, verified = true) {
      session = { owner, verified, revision: session.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
  }
}
function input(editor: EditorController, title = 'title'): void { editor.edit('title', title); editor.edit('content', 'body') }

test('editor feature retries frozen draft creation before saving newer input', async () => {
  const f = fixture()
  const save = f.ports.content.saveDraft
  f.ports.content.saveDraft = async request => {
    if (!f.requests.length) { f.requests.push({ ...request }); throw new Error('response lost') }
    return save(request)
  }
  input(f.editor, 'first')
  await f.editor.save()
  f.editor.edit('title', 'second')
  await f.editor.save()
  assert.equal(f.editor.snapshot().dirty, true)
  assert.equal(f.editor.snapshot().draftId, 'draft-one')
  await f.editor.save()
  assert.equal(f.editor.snapshot().dirty, false)
  assert.deepEqual(f.requests.map(request => request.title), ['first', 'first', 'second'])
  assert.equal(f.requests[0]?.request_id, f.requests[1]?.request_id)
  assert.equal(f.requests[2]?.expected_revision, 1)
  assert.equal(f.requests[2]?.draft_id, 'draft-one')
  assert.equal(f.requests[2]?.request_id, undefined)
})

test('editor recovery preserves the pending payload across restart and never crosses accounts', async () => {
  const f = fixture()
  f.ports.content.saveDraft = async () => { throw new Error('offline') }
  input(f.editor, 'private')
  await f.editor.save()
  const id = f.storage.get('alice')?.pendingCreate?.request_id
  assert.ok(id)
  f.editor.dispose()
  const restored = f.make()
  await restored.initialize()
  restored.resolveRecovery(true)
  assert.equal(restored.snapshot().title, 'private')
  await restored.save()
  assert.equal(f.storage.get('alice')?.pendingCreate?.request_id, id)
  f.switchAccount('bob')
  assert.equal(restored.snapshot().title, '')
  const bob = f.make()
  const before = f.events.filter(event => event.type === 'recovery-available').length
  await bob.initialize()
  assert.equal(f.events.filter(event => event.type === 'recovery-available').length, before)
  f.ports.recovery.write = () => { throw new Error('disk full') }
  input(bob, 'bob text')
  await bob.save()
  assert.match(bob.snapshot().lastSavedAt, /保存失败/)
  assert.equal(f.storage.has('bob'), false)
})

test('editor disposal cancels scheduled work and rejects a late save without writing another account', async () => {
  const f = fixture(), response = deferred<Draft>()
  f.ports.content.saveDraft = () => response.promise
  input(f.editor, 'private')
  const pending = f.editor.save()
  f.editor.dispose()
  f.switchAccount('bob')
  const before = f.states.length
  response.resolve(draft({ title: 'private', content: 'body', category_id: '', anonymous: false }))
  await pending
  assert.equal(f.states.length, before)
  assert.equal(f.scheduled.size, 0)
  assert.equal(f.listeners.size, 0)
  assert.equal(f.storage.has('bob'), false)
  assert.equal(f.storage.get('alice')?.title, 'private')
})

test('editor source loading cannot overwrite newer input or revive a hidden or different-account view', async () => {
  for (const mode of ['edit', 'draft'] as const) {
    for (const interrupt of ['input', 'hide', 'account'] as const) {
      const f = fixture({ mode, postId: mode === 'edit' ? 'post' : '', draftId: mode === 'draft' ? 'draft-one' : '' })
      const response = deferred<Draft>()
      f.ports.content.post = () => response.promise
      f.ports.content.drafts = async () => [await response.promise]
      const pending = f.editor.initialize()
      await Promise.resolve() // Let independent categories finish before testing source completion.
      if (interrupt === 'input') f.editor.edit('title', 'new typing')
      if (interrupt === 'hide') f.editor.hide()
      if (interrupt === 'account') f.switchAccount('bob')
      const before = f.states.length, events = f.events.length
      response.resolve(draft({ title: 'old', content: 'old', category_id: '', anonymous: false }))
      await pending
      assert.equal(f.states.length, before, `${mode}/${interrupt}`)
      assert.equal(f.events.length, events)
    }
  }
})

test('editor absorbs its own committed draft revision across hide and show without rendering while hidden', async () => {
  for (const resolveWhileHidden of [true, false]) {
    const f = fixture({ mode: 'draft', postId: '', draftId: 'draft-one' }), response = deferred<Draft>()
    await f.editor.initialize()
    let cloudRevision = 1
    const versions: (number | undefined)[] = []
    f.ports.content.saveDraft = async request => {
      versions.push(request.expected_revision)
      assert.equal(request.expected_revision, cloudRevision)
      cloudRevision += 1
      return versions.length === 1 ? response.promise : draft(request, cloudRevision)
    }
    f.editor.edit('title', 'first edit')
    const pending = f.editor.save()
    f.editor.hide()
    if (!resolveWhileHidden) f.editor.show()
    const renders = f.states.length
    response.resolve(draft({ title: 'first edit', content: 'body', category_id: '', anonymous: false }, 2))
    await pending
    if (resolveWhileHidden) {
      assert.equal(f.states.length, renders)
      assert.equal(f.storage.get('alice')?.draftRevision, 2)
      f.editor.show()
    }
    f.editor.edit('title', 'second edit')
    await f.editor.save()
    assert.deepEqual(versions, [1, 2])
    assert.equal(f.editor.snapshot().lastSavedAt, '刚刚')
    assert.equal(f.editor.snapshot().dirty, false)
  }
})

test('editor publication ignores late completion and cannot start after an invalidated save wait', async () => {
  for (const waitingForSave of [false, true]) {
    const f = fixture(), save = deferred<Draft>(), publish = deferred<PostMutationReceipt>()
    let publications = 0
    f.ports.content.saveDraft = () => save.promise
    f.ports.content.create = () => { publications++; return publish.promise }
    input(f.editor)
    const saving = waitingForSave ? f.editor.save() : Promise.resolve()
    const pending = f.editor.submit()
    f.editor.hide()
    const before = f.states.length, events = f.events.length
    save.resolve(draft({ title: 'title', content: 'body', category_id: '', anonymous: false }))
    publish.resolve(receipt)
    await Promise.all([saving, pending])
    assert.equal(f.states.length, before)
    assert.equal(f.events.length, events)
    assert.equal(publications, waitingForSave ? 0 : 1)
    assert.equal(f.editor.canNavigateBack(), false)
    assert.equal(f.cleanups.length, 0)
  }
})

test('editor publication restores the exact retry payload after restart and blocks edits while uncertain', async () => {
  const f = fixture(), requests: unknown[] = []
  f.ports.content.create = async (data, anonymous, requestId) => { requests.push({ data, anonymous, requestId }); throw new Error('lost confirmation') }
  input(f.editor, 'original')
  await f.editor.submit()
  f.editor.edit('title', 'changed')
  assert.equal(f.editor.snapshot().title, 'original')
  assert.equal(f.editor.snapshot().publicationPending, true)
  f.editor.dispose()
  const restored = f.make()
  await restored.initialize()
  restored.resolveRecovery(true)
  await restored.submit()
  assert.deepEqual(requests[1], requests[0])
  assert.equal(restored.snapshot().publicationPending, true)
  assert.equal(f.scheduled.size, 0)
})

test('editor restores the retry button after hide and show without applying stale publication effects', async () => {
  const f = fixture(), response = deferred<PostMutationReceipt>(), requests: string[] = []
  f.ports.content.create = async (_input, _anonymous, requestId) => {
    requests.push(requestId)
    return requests.length === 1 ? response.promise : receipt
  }
  input(f.editor)
  const pending = f.editor.submit()
  f.editor.hide()
  f.editor.show()
  response.resolve(receipt)
  await pending
  assert.equal(f.editor.snapshot().submitting, false)
  assert.equal(f.editor.snapshot().publicationPending, true)
  assert.equal(f.editor.canNavigateBack(), false)
  assert.equal(f.events.some(event => event.type === 'published'), false)
  await f.editor.submit()
  assert.equal(requests.length, 2)
  assert.equal(requests[1], requests[0])
  assert.equal(f.editor.canNavigateBack(), true)
})

test('editor recovery retains edit mode, original post and optimistic revision', async () => {
  const f = fixture({ mode: 'edit', postId: 'original-post', draftId: '' })
  await f.editor.initialize()
  f.editor.edit('title', 'edited')
  f.editor.dispose()
  const restored = f.make(createRoute)
  await restored.initialize()
  restored.resolveRecovery(true)
  assert.equal(restored.snapshot().mode, 'edit')
  const updates: unknown[] = []
  f.ports.content.update = async (...args) => { updates.push(args); return receipt }
  await restored.submit()
  assert.deepEqual(updates, [['original-post', { title: 'edited', content: 'body', category_id: '' }, false, 7]])
})

test('editor keeps recovery and avoids cleanup when the API rejects a malformed publication receipt', async () => {
  const f = fixture({ mode: 'draft', postId: '', draftId: 'draft-one' })
  await f.editor.initialize()
  f.ports.content.create = async () => parsePostMutationReceipt({ flagged: false }, 'create')
  await f.editor.submit()
  assert.equal(f.editor.snapshot().publicationPending, true)
  assert.ok(f.storage.get('alice')?.publication?.requestId)
  assert.equal(f.cleanups.length, 0)
  assert.equal(f.editor.canNavigateBack(), false)
  assert.equal(f.events.some(event => event.type === 'published'), false)
})

test('editor resolves an uncertain draft before publication and only cleans creation revision one', async () => {
  for (const confirmedRevision of [1, 2]) {
    const f = fixture(), calls: string[] = []
    f.ports.content.saveDraft = async () => { throw new Error('lost') }
    input(f.editor, 'initial draft')
    await f.editor.save()
    const request = f.storage.get('alice')?.pendingCreate
    assert.ok(request)
    f.editor.edit('title', 'publish latest')
    f.ports.content.saveDraft = async value => { calls.push('save'); assert.deepEqual(value, request); return draft(value, confirmedRevision) }
    f.ports.content.create = async value => { calls.push('create'); assert.equal(value.title, 'publish latest'); return receipt }
    await f.editor.submit()
    assert.deepEqual(calls, ['save', 'create'])
    assert.deepEqual(f.cleanups, [{ id: 'draft-one', revision: 1 }])
    assert.equal(f.editor.canNavigateBack(), true)
    assert.equal(f.storage.has('alice'), false)
  }
})

test('editor draft confirmation failure prevents publication and preserves the unresolved creation', async () => {
  const f = fixture()
  f.ports.content.saveDraft = async () => { throw new Error('offline') }
  let publications = 0
  f.ports.content.create = async () => { publications++; return receipt }
  input(f.editor, 'initial')
  await f.editor.save()
  const request = f.storage.get('alice')?.pendingCreate
  f.editor.edit('title', 'latest')
  await f.editor.submit()
  assert.equal(publications, 0)
  assert.deepEqual(f.storage.get('alice')?.pendingCreate, request)
  assert.equal(f.storage.get('alice')?.title, 'initial') // Original recovery stays durable until another checkpoint.
  assert.equal(f.editor.snapshot().title, 'latest')
  assert.equal(f.editor.canNavigateBack(), false)
})

test('editor rejects a recovery modal answer from a previous view and cancels navigation after account loss', async () => {
  const f = fixture()
  input(f.editor)
  f.editor.dispose()
  const restored = f.make()
  await restored.initialize()
  restored.hide()
  restored.show()
  restored.resolveRecovery(true)
  assert.equal(restored.snapshot().title, '')
  input(restored)
  await restored.submit()
  assert.equal(restored.canNavigateBack(), true)
  f.switchAccount('bob')
  assert.equal(restored.canNavigateBack(), false)
})

test('editor resumes navigation from a confirmed publication without submitting or notifying the opener twice', async () => {
  const f = fixture()
  let writes = 0
  f.ports.content.create = async () => { writes++; return receipt }
  input(f.editor)
  await f.editor.submit()
  f.editor.hide()
  assert.equal(f.editor.canNavigateBack(), false)
  f.editor.show()
  assert.equal(f.editor.canNavigateBack(), true)
  assert.equal(f.events.filter(event => event.type === 'published').length, 1)
  assert.equal(f.events[f.events.length - 1]?.type, 'close')
  await f.editor.submit()
  assert.equal(writes, 1)
})

test('editor validates route modes instead of asserting arbitrary external text as a mode', () => {
  assert.deepEqual(parseEditorRoute({ mode: 'invalid', post_id: 'post' }), createRoute)
  assert.deepEqual(parseEditorRoute({ mode: 'edit', post_id: 123 }), createRoute)
  assert.deepEqual(parseEditorRoute({ mode: 'edit', post_id: 'post' }), { mode: 'edit', postId: 'post', draftId: '' })
})

interface EditorPage {
  data: EditorState & { navHeight: number }
  setData(state: Partial<EditorState & { navHeight: number }>): void
  onLoad(options: Record<string, string>): void
  onShow(): void
  onHide(): void
  onUnload(): void
  onTitleInput(event: { detail: { value: string } }): void
  onContentInput(event: { detail: { value: string } }): void
  onSubmit(): Promise<void>
  getOpenerEventChannel(): { emit(name: string): void }
}
test('editor page wires inputs and lifecycle to the feature and cancels delayed navigation on hide', async () => {
  const f = fixture(), captured: { page?: EditorPage } = {}, uiTimers = new Set<() => void>(), events: string[] = []
  const filename = path.resolve(__dirname, '../apps/miniprogram/pages/editor/editor.ts')
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: (name: string) => {
      if (name.endsWith('/composition/editor')) return { createEditor: (route: EditorRoute, observer: EditorObserver) => f.make(route, observer) }
      if (name.endsWith('/features/editor/index')) return { initialEditorState, parseEditorRoute }
      if (name.endsWith('/utils/guard')) return { requireVerified: () => true }
      if (name.endsWith('/generated/contracts/index')) return { POST_CONTENT_LIMIT }
      throw new Error(`Unexpected page dependency: ${name}`)
    },
    Page: (page: EditorPage) => {
      page.setData = state => { Object.assign(page.data, state) }
      page.getOpenerEventChannel = () => ({ emit: name => { events.push(name) } })
      captured.page = page
    },
    wx: { getWindowInfo: () => ({ statusBarHeight: 44 }), setNavigationBarTitle: () => {},
      showToast: () => {}, navigateBack: () => { events.push('navigateBack') } },
    setTimeout: (action: () => void) => { uiTimers.add(action); return action },
    clearTimeout: (action: () => void) => { uiTimers.delete(action) },
  }, { filename })
  const page = captured.page
  assert.ok(page)
  page.onLoad({})
  page.onShow()
  page.onTitleInput({ detail: { value: 'page title' } })
  page.onContentInput({ detail: { value: 'page body' } })
  assert.equal(page.data.title, 'page title')
  assert.equal(page.data.titleLen, 10)
  await page.onSubmit()
  assert.deepEqual(events, ['postChanged'])
  assert.equal(uiTimers.size, 1)
  page.onHide()
  assert.equal(uiTimers.size, 0)
  page.onShow()
  assert.equal(uiTimers.size, 1)
  assert.deepEqual(events, ['postChanged'])
  page.onUnload()
  assert.equal(uiTimers.size, 0)
  assert.equal(f.scheduled.size, 0)
})
