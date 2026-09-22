import type { PostCursor, PostView, PublicPostPage } from '../../generated/contracts/index'
import { ViewScope, type ViewSessionPort } from '../session/index'

export interface PostListState {
  items: PostView[]; total: number | null; hasMore: boolean; loadingMore: boolean
  state: 'idle' | 'loading' | 'loaded' | 'empty' | 'error'; error: string
}
export const initialPostList = (): PostListState => ({ items: [], total: null, hasMore: true, loadingMore: false, state: 'idle', error: '' })
export class PostListController {
  private state = initialPostList()
  private cursor: PostCursor | null = null
  private filter: string | null = null
  private sequence = 0
  private active = false
  private readonly scope: ViewScope
  constructor(session: ViewSessionPort, private readonly read: (filter: string, cursor: PostCursor | null) => Promise<PublicPostPage>,
    private readonly render: (state: PostListState) => void) {
    this.scope = new ViewScope(session, visible => {
      this.sequence++
      this.cursor = null
      this.active = false
      this.update(initialPostList())
      if (visible && this.filter !== null) void this.refresh()
    })
  }
  private update(change: Partial<PostListState>): void { this.state = { ...this.state, ...change }; this.render(this.state) }
  async select(filter: string): Promise<void> {
    if (this.filter !== filter) { this.filter = filter; this.cursor = null; this.update(initialPostList()) }
    await this.refresh()
  }
  refresh(): Promise<void> { return this.load(true) }
  more(): Promise<void> { return this.load(false) }
  private async load(reset: boolean): Promise<void> {
    if (this.filter === null || (!reset && (this.active || !this.state.hasMore))) return
    const token = this.scope.capture()
    if (!this.scope.current(token)) return
    const sequence = ++this.sequence, filter = this.filter
    this.active = true
    this.update({ state: this.state.items.length ? 'loaded' : 'loading', loadingMore: this.state.items.length > 0, error: '' })
    try {
      const page = await this.read(filter, reset ? null : this.cursor)
      if (sequence !== this.sequence || !this.scope.current(token)) return
      const items = [...new Map((reset ? page.items : [...this.state.items, ...page.items]).map(item => [item._id, item])).values()]
      this.cursor = page.nextCursor
      this.update({ items, total: page.total, hasMore: page.hasMore, state: items.length ? 'loaded' : 'empty', loadingMore: false })
    } catch (error) {
      if (sequence !== this.sequence || !this.scope.current(token)) return
      this.update({ state: this.state.items.length ? 'loaded' : 'error', loadingMore: false, error: error instanceof Error ? error.message : '加载失败' })
    } finally { if (sequence === this.sequence) this.active = false }
  }
  show(): void {
    this.scope.show()
    if (this.filter !== null && !this.active && (this.state.state === 'loading' || this.state.state === 'idle')) void this.refresh()
  }
  hide(): void { this.scope.hide(); this.sequence++; this.active = false; this.update({ loadingMore: false }) }
  dispose(): void { this.sequence++; this.active = false; this.scope.dispose() }
}
