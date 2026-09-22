import { commentPrecedes, type CommentHistoryCursor, type CommentHistoryPage, type CommentCursor, type CommentView,
  type parseCommentSyncPage } from '../../generated/contracts/index'
import { ViewScope, type ViewSessionPort } from '../session/index'

type ChangePage = ReturnType<typeof parseCommentSyncPage>
export interface CommentThreadPort {
  history(postId: string, cursor: CommentHistoryCursor | null): Promise<CommentHistoryPage>
  changes(postId: string, cursor: CommentCursor): Promise<ChangePage>
  repeat(work: () => Promise<void>): () => void
}
export interface CommentTree extends CommentView { replies: CommentView[] }
export interface CommentThreadState { comments: CommentTree[]; state: 'idle' | 'loading' | 'loaded' | 'empty' | 'error'; hasMore: boolean; loadingMore: boolean }
export function commentTree(items: CommentView[]): CommentTree[] {
  const ordered = [...items].sort((a, b) => a._id === b._id ? 0 : commentPrecedes(a, b) ? -1 : 1)
  const children = new Map<string, CommentView[]>()
  for (const item of ordered) if (item.parent_id) children.set(item.parent_id, [...(children.get(item.parent_id) || []), item])
  return ordered.filter(item => !item.parent_id).map(item => ({ ...item, replies: children.get(item._id) || [] }))
}
export class CommentThreadController {
  private readonly scope: ViewScope
  private items = new Map<string, CommentView>()
  private changed = new Map<string, number>()
  private state: CommentThreadState = { comments: [], state: 'idle', hasMore: true, loadingMore: false }
  private postId = ''
  private historyCursor: CommentHistoryCursor | null = null
  private syncCursor: CommentCursor | null = null
  private sequence = 0
  private polling = false
  private loading = false
  private stop: (() => void) | null = null
  constructor(session: ViewSessionPort, private readonly port: CommentThreadPort, private readonly render: (state: CommentThreadState) => void) {
    this.scope = new ViewScope(session, visible => {
      this.cancel(); this.items.clear(); this.changed.clear(); this.syncCursor = null; this.historyCursor = null
      this.update({ comments: [], state: 'idle', hasMore: true, loadingMore: false })
      if (visible && this.postId) void this.refresh(this.postId)
    })
  }
  private update(change: Partial<CommentThreadState>): void { this.state = { ...this.state, ...change }; this.render(this.state) }
  async refresh(postId: string): Promise<void> {
    this.cancel(); this.postId = postId; this.syncCursor = null
    await this.load(true)
  }
  more(): Promise<void> { return this.load(false) }
  private async load(reset: boolean): Promise<void> {
    const token = this.scope.capture()
    if (!this.scope.current(token) || !this.postId || (!reset && (this.loading || !this.state.hasMore || !this.syncCursor))) return
    const generation = this.sequence, startSequence = this.syncCursor?.sequence ?? 0
    this.loading = true
    this.update({ state: this.items.size ? 'loaded' : 'loading', loadingMore: !reset })
    try {
      const page = await this.port.history(this.postId, reset ? null : this.historyCursor)
      if (generation !== this.sequence || !this.scope.current(token)) return
      if (reset) { this.items.clear(); this.changed.clear(); this.syncCursor = page.syncCursor }
      for (const item of page.items) if ((this.changed.get(item._id) ?? 0) <= startSequence) this.items.set(item._id, item)
      this.historyCursor = page.nextCursor
      this.update({ comments: commentTree([...this.items.values()]), state: this.items.size ? 'loaded' : 'empty', hasMore: page.hasMore, loadingMore: false })
      if (reset) { this.stop = this.port.repeat(() => this.poll()); void this.poll() }
    } catch (_) {
      if (generation === this.sequence && this.scope.current(token)) this.update({ state: this.items.size ? 'loaded' : 'error', loadingMore: false })
    } finally { if (generation === this.sequence) this.loading = false }
  }
  async poll(): Promise<void> {
    const token = this.scope.capture(), generation = this.sequence
    if (this.polling || !this.syncCursor || !this.scope.current(token)) return
    this.polling = true
    let cursor = this.syncCursor
    const pending = new Map<string, ChangePage['changes'][number]>()
    try {
      for (let pages = 0; pages < 5; pages++) {
        const result = await this.port.changes(this.postId, cursor)
        if (generation !== this.sequence || !this.scope.current(token)) return
        for (const change of result.changes) pending.set(change.comment_id, change)
        cursor = result.nextCursor
        if (!result.hasMore) break
      }
      for (const [id, change] of pending) {
        this.changed.set(id, change.sequence)
        if (change.comment && change.comment.status !== 'flagged') this.items.set(id, change.comment)
        else this.items.delete(id)
      }
      if (pending.size) this.update({ comments: commentTree([...this.items.values()]), state: this.items.size ? 'loaded' : 'empty' })
      this.syncCursor = cursor
    } catch (_) {
      // Keep the last delivered cursor. A failed second page cannot discard the first page's events.
    } finally { if (generation === this.sequence) this.polling = false }
  }
  private cancel(): void { this.sequence++; this.stop?.(); this.stop = null; this.polling = false; this.loading = false }
  show(): void { this.scope.show() }
  hide(): void { this.scope.hide(); this.cancel() }
  dispose(): void { this.cancel(); this.scope.dispose() }
}
