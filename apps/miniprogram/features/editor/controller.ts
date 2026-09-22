import { POST_CONTENT_LIMIT, type SaveDraftRequest } from '../../generated/contracts/index'
import { initialEditorState, type EditorObserver, type EditorRoute, type EditorState } from './model'
import type { EditorPorts } from './ports'
import { parseEditorRecovery, type EditorRecovery, type PendingPublication } from './recovery'

interface ViewToken { generation: number; revision: number }
const AUTO_SAVE_MS = 2000

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

/** One owner for editor state, save/publication sequencing, and account-scoped recovery. */
export class EditorController {
  private state = initialEditorState()
  private readonly owner: string
  private postId: string
  private postRevision = 0
  private draftRevision = 0
  private editRevision = 0
  private pendingCreate: SaveDraftRequest | null = null
  private publication: PendingPublication | null = null
  private offeredRecovery: { value: EditorRecovery; token: ViewToken } | null = null
  private savePromise: Promise<void> | null = null
  private cancelSave: (() => void) | null = null
  private unsubscribe: (() => void) | null
  private generation = 0
  private visible = true
  private disposed = false
  private submitting = false
  private submitted = false
  private completion: ViewToken | null = null

  constructor(private readonly route: EditorRoute, private readonly ports: EditorPorts, private readonly observer: EditorObserver) {
    this.owner = ports.session.current().owner || ''
    this.postId = route.postId
    this.state = { ...this.state, mode: route.mode, anonymousMode: ports.anonymous.get() }
    this.unsubscribe = ports.session.subscribe(() => {
      const current = ports.session.current()
      if (current.owner === this.owner && current.verified) return
      this.dispose()
      this.pendingCreate = null
      this.publication = null
      this.state = initialEditorState()
      this.observer.state(this.snapshot())
    })
  }

  snapshot(): EditorState { return { ...this.state, categories: [...this.state.categories] } }
  private patch(update: Partial<EditorState>): void {
    this.state = { ...this.state, ...update }
    this.observer.state(this.snapshot())
  }
  private token(): ViewToken { return { generation: this.generation, revision: this.ports.session.current().revision } }
  private sameSession(token: ViewToken): boolean {
    const session = this.ports.session.current()
    return !this.disposed && !!this.owner && session.verified && session.owner === this.owner && token.revision === session.revision
  }
  private current(token = this.token()): boolean {
    return this.sameSession(token) && this.visible && token.generation === this.generation
  }
  /** A committed write belongs to this editor even across hide/show; rendering still requires an active view. */
  private acceptSavedState(update: Partial<EditorState>): void {
    this.state = { ...this.state, ...update }
    if (this.current()) this.observer.state(this.snapshot())
  }
  private notice(message: string, success = false): void { this.observer.event({ type: 'notice', message, success }) }
  private stopSave(): void { this.cancelSave?.(); this.cancelSave = null }
  private scheduleSave(): void {
    this.stopSave()
    if (!this.current() || this.submitted || this.publication) return
    this.cancelSave = this.ports.schedule(AUTO_SAVE_MS, () => { this.cancelSave = null; void this.save() })
  }

  async initialize(): Promise<void> {
    if (!this.current()) return
    this.patch({})
    await Promise.all([this.loadCategories(), this.loadSource()])
  }

  show(): void {
    this.visible = true
    if (!this.current()) return
    this.patch({ submitting: this.submitting })
    if (this.submitted) {
      // Resuming a confirmed editor creates a fresh navigation intent, never replays publication.
      this.completion = this.token()
      this.observer.event({ type: 'close' })
      return
    }
    if (this.state.dirty) this.scheduleSave()
    if (this.state.mode === 'create' && !this.publication) this.patch({ anonymousMode: this.ports.anonymous.get() })
  }

  hide(): void {
    this.generation += 1
    this.visible = false
    this.stopSave()
    if ((this.state.dirty || this.publication) && !this.submitted) this.persistRecovery()
  }

  dispose(): void {
    if (this.disposed) return
    this.hide()
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  canNavigateBack(): boolean { return this.submitted && this.completion !== null && this.current(this.completion) }

  edit(field: 'title' | 'content' | 'categoryId', value: string): void {
    if (!this.current() || this.submitting || this.publication || this.submitted) return
    this.patch({ [field]: value, ...(field === 'title' ? { titleLen: value.length } : {}),
      ...(field === 'content' ? { contentLen: value.length } : {}), dirty: true })
    this.editRevision += 1
    this.scheduleSave()
  }

  setAnonymous(value: boolean): void {
    if (!this.current() || this.submitting || this.publication || this.submitted) return
    this.ports.anonymous.set(value)
    this.patch({ anonymousMode: value, dirty: true })
    this.editRevision += 1
    this.scheduleSave()
  }

  private async loadCategories(): Promise<void> {
    const token = this.token()
    try {
      const categories = await this.ports.content.categories()
      if (this.current(token)) this.patch({ categories, categoriesReady: true })
    } catch (_) { if (this.current(token)) this.patch({ categoriesReady: true }) }
  }

  private async loadSource(): Promise<void> {
    const token = this.token(), revision = this.editRevision
    try {
      if (this.route.mode === 'edit') {
        const post = await this.ports.content.post(this.postId)
        if (!this.current(token) || revision !== this.editRevision) return
        if (!post) { this.postId = ''; this.patch({ mode: 'create' }); this.notice('帖子不存在'); return }
        this.postRevision = post.revision
        this.patch({ title: post.title, content: post.content, categoryId: post.category_id,
          titleLen: post.title.length, contentLen: post.content.length, anonymousMode: post.anonymous })
      } else if (this.route.mode === 'draft') {
        const drafts = await this.ports.content.drafts()
        if (!this.current(token) || revision !== this.editRevision) return
        const draft = drafts.find(item => item._id === this.route.draftId)
        if (!draft) { this.patch({ mode: 'create' }); this.notice('草稿不存在'); return }
        this.draftRevision = draft.revision
        this.patch({ title: draft.title, content: draft.content, categoryId: draft.category_id, draftId: draft._id,
          titleLen: draft.title.length, contentLen: draft.content.length, anonymousMode: draft.anonymous })
      } else {
        this.offerRecovery()
      }
    } catch (_) {
      if (this.current(token) && revision === this.editRevision) this.notice(this.route.mode === 'draft' ? '加载草稿失败' : '加载失败，请重试')
    }
  }

  private offerRecovery(): void {
    try {
      const value = this.ports.recovery.read(this.owner)
      if (!value) return
      const recovery = parseEditorRecovery(value, this.owner)
      if (!recovery.title && !recovery.content) return
      this.offeredRecovery = { value: recovery, token: this.token() }
      this.observer.event({ type: 'recovery-available' })
    } catch (_) { /* Unavailable or invalid local data cannot replace the current editor. */ }
  }

  resolveRecovery(restore: boolean): void {
    const offered = this.offeredRecovery
    this.offeredRecovery = null
    if (!offered || !this.current(offered.token)) return
    if (!restore) {
      try { this.ports.recovery.remove(this.owner) } catch (_) { /* Keep the editor usable without storage. */ }
      return
    }
    const value = offered.value
    this.postId = value.postId
    this.postRevision = value.postRevision
    this.draftRevision = value.draftRevision
    this.pendingCreate = value.pendingCreate
    this.publication = value.publication
    this.editRevision += 1
    this.patch({ mode: value.mode, title: value.title, content: value.content, categoryId: value.categoryId,
      anonymousMode: value.anonymous, draftId: value.draftId, titleLen: value.title.length,
      contentLen: value.content.length, dirty: true, publicationPending: !!value.publication })
    this.scheduleSave()
  }

  persistRecovery(): boolean {
    if (!this.owner) return false
    try {
      const value = parseEditorRecovery({ version: 2, owner: this.owner, mode: this.state.mode,
        postId: this.postId, postRevision: this.postRevision, publication: this.publication,
        title: this.state.title, content: this.state.content, categoryId: this.state.categoryId,
        anonymous: this.state.anonymousMode, draftId: this.state.draftId, draftRevision: this.draftRevision,
        pendingCreate: this.pendingCreate }, this.owner)
      this.ports.recovery.write(this.owner, value)
      return true
    } catch (_) { return false }
  }

  /** Retry an uncertain initial creation with the identical ID and content before saving later edits. */
  async save(): Promise<void> {
    if (!this.current() || !this.state.dirty || this.submitting || this.submitted || this.publication) return
    this.stopSave()
    if (this.state.content.length > POST_CONTENT_LIMIT) {
      this.patch({ lastSavedAt: `正文最多 ${POST_CONTENT_LIMIT} 字，请精简后保存` })
      this.persistRecovery()
      return
    }
    if (this.savePromise) {
      await this.savePromise
      if (this.state.dirty && !this.submitting) await this.save()
      return
    }
    const token = this.token(), revision = this.editRevision
    const current: SaveDraftRequest = { title: this.state.title, content: this.state.content,
      category_id: this.state.categoryId, anonymous: this.state.anonymousMode,
      ...(this.state.draftId ? { draft_id: this.state.draftId, expected_revision: this.draftRevision } : {}) }
    if (!this.state.draftId && !this.pendingCreate) this.pendingCreate = { ...current, request_id: this.ports.requestId() }
    const snapshot = this.pendingCreate || current
    this.persistRecovery()
    let saved = false
    const work = (async () => {
      try {
        const draft = await this.ports.content.saveDraft(snapshot)
        if (!this.sameSession(token)) return
        saved = true
        this.pendingCreate = null
        this.draftRevision = draft.revision
        this.acceptSavedState({ draftId: draft._id })
        if (revision === this.editRevision && snapshot.title === this.state.title && snapshot.content === this.state.content
          && snapshot.category_id === this.state.categoryId && snapshot.anonymous === this.state.anonymousMode) {
          this.acceptSavedState({ dirty: false, lastSavedAt: '刚刚' })
        }
        this.persistRecovery()
      } catch (error: unknown) {
        if (!this.current(token)) return
        const code = errorCode(error)
        if (code === 'DRAFT_CONFLICT') {
          this.patch({ lastSavedAt: this.persistRecovery() ? '草稿冲突，已本地保留' : '草稿冲突，请保留当前页面' })
          this.notice('草稿已在其他设备更新，请刷新后再保存')
        } else if (code === 'DRAFT_LIMIT_REACHED') {
          this.notice('草稿箱已满，请清理后重试')
        } else {
          this.patch({ lastSavedAt: this.persistRecovery() ? '已离线保存' : '保存失败，请保留当前页面' })
        }
      }
    })()
    this.savePromise = work
    try { await work } finally { if (this.savePromise === work) this.savePromise = null }
    if (saved && this.state.dirty) this.scheduleSave()
  }

  async submit(): Promise<void> {
    if (!this.current() || this.submitting || this.submitted) return
    const token = this.token()
    const { title, content, categoryId, mode } = this.state
    if (!title.trim()) { this.notice('请输入标题'); return }
    if (!content.trim()) { this.notice('请输入内容'); return }
    if (content.trim().length > POST_CONTENT_LIMIT) { this.notice(`正文最多 ${POST_CONTENT_LIMIT} 字`); return }
    this.stopSave()
    this.submitting = true
    this.patch({ submitting: true })
    try {
      if (this.savePromise) await this.savePromise
      if (!this.current(token)) return
      if (this.pendingCreate) {
        const draft = await this.ports.content.saveDraft(this.pendingCreate)
        if (!this.current(token)) return
        // Only creation revision 1 may be cleaned; an intervening edit must survive publication.
        this.draftRevision = 1
        this.pendingCreate = null
        this.patch({ draftId: draft._id })
        this.persistRecovery()
      }
      const input = { title: title.trim(), content: content.trim(), category_id: categoryId }
      if (mode === 'edit' && this.postId) {
        await this.ports.content.update(this.postId, input, this.state.anonymousMode, this.postRevision)
        if (!this.current(token)) return
        this.notice('修改已保存', true)
      } else {
        if (!this.publication) {
          this.publication = { requestId: this.ports.requestId(), title: input.title, content: input.content,
            categoryId, anonymous: this.state.anonymousMode }
          this.patch({ publicationPending: true })
          this.persistRecovery()
        }
        const publication = this.publication
        const result = await this.ports.content.create({ title: publication.title, content: publication.content,
          category_id: publication.categoryId }, publication.anonymous, publication.requestId)
        if (!this.current(token)) return
        this.notice(result.flagged ? '发布成功，内容审核中' : '发布成功', !result.flagged)
      }
      if (this.state.draftId) {
        try {
          this.ports.content.enqueueCleanup(this.state.draftId, this.draftRevision)
          void this.ports.content.flushCleanup().catch(() => {})
        } catch (_) { this.notice('发布成功，草稿需在草稿箱手动清理') }
      }
      try { this.ports.recovery.remove(this.owner) } catch (_) { /* Publication is already confirmed. */ }
      this.submitted = true
      this.completion = token
      this.publication = null
      this.patch({ publicationPending: false })
      this.observer.event({ type: 'published' })
    } catch (error: unknown) {
      if (!this.current(token)) return
      if (['INVALID_INPUT', 'FORBIDDEN', 'UNVERIFIED', 'RATE_LIMITED', 'RATE_LIMIT_UNAVAILABLE'].includes(errorCode(error) || '')) {
        this.publication = null
        this.patch({ publicationPending: false })
        this.persistRecovery()
      }
      this.notice(this.publication ? '发布结果未确认，请重试确认，内容已锁定' : error instanceof Error ? error.message : '发布失败')
    } finally {
      this.submitting = false
      // A re-shown page must unlock retries, without applying the old publication's success effects.
      if (this.current()) {
        this.patch({ submitting: false })
        if (!this.submitted && this.state.dirty) this.scheduleSave()
      }
    }
  }
}
