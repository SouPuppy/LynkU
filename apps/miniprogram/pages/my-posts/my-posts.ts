// pages/my-posts — user's post list with edit/delete
import type { IPost, LoadState } from '../../typings/cloudbase'
import * as session from '../../services/session'
import { listMyPosts, deletePost } from '../../services/posts'
import { requireVerified } from '../../utils/guard'
import type { OwnedPostCursor } from '../../generated/contracts/index'

Page({
  data: {
    posts: [] as IPost[],
    cursor: null as OwnedPostCursor | null,
    hasMore: false,
    loadingMore: false,
    loadError: false,
    refreshing: false,
    state: 'idle' as LoadState,
    skRows4: [1, 2, 3, 4],
  },

  _requestSeq: 0,
  _retryReset: true,
  _unsubscribe: null as (() => void) | null,

  onShow() {
    this._unsubscribe?.()
    this._unsubscribe = session.onChange(() => {
      this._requestSeq += 1
      this.setData({ posts: [], state: 'idle', cursor: null, hasMore: false, loadingMore: false, refreshing: false, loadError: false })
    })
    if (!requireVerified()) return
    this.loadPosts()
  },

  onHide() { this._requestSeq += 1 },
  onUnload() {
    this._requestSeq += 1
    this._unsubscribe?.()
    this._unsubscribe = null
  },

  async loadPosts(reset = true) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return
    this._retryReset = reset
    const seq = ++this._requestSeq
    this.setData({ loadingMore: true, loadError: false })
    if (this.data.posts.length === 0) this.setData({ state: 'loading' })
    try {
      const openid = session.getOpenid()
      const result = openid
        ? await listMyPosts(reset ? null : this.data.cursor)
        : { items: [], total: 0, hasMore: false, nextCursor: null }
      if (seq !== this._requestSeq) return
      const previous = reset ? [] : this.data.posts
      const ids = new Set(previous.map(post => post._id))
      this.setData({ posts: [...previous, ...result.items.filter(post => !ids.has(post._id))], state: 'loaded',
        cursor: result.nextCursor, hasMore: result.hasMore, loadingMore: false, refreshing: false })
    } catch (_) {
      if (seq !== this._requestSeq) return
      this.setData({ state: this.data.posts.length === 0 ? 'error' : 'loaded', loadError: true, loadingMore: false, refreshing: false })
    }
  },

  onPostTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/post/post?id=${id}` })
  },

  onEditTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/editor/editor?mode=edit&post_id=${id}` })
  },

  async onDeleteTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const revision = session.getRevision()
    const seq = this._requestSeq
    const res = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>(resolve => {
      wx.showModal({
        title: '删除帖子',
        content: '确定删除这个帖子吗？删除后无法恢复。',
        confirmText: '删除',
        confirmColor: '#ee0a24',
        success: resolve,
      })
    })
    if (!res.confirm || revision !== session.getRevision() || seq !== this._requestSeq) return

    try {
      await deletePost(id)
      if (revision !== session.getRevision() || seq !== this._requestSeq) return
      const posts = this.data.posts.filter(p => p._id !== id)
      this.setData({
        posts,
        state: posts.length === 0 ? 'loaded' : 'loaded',
      })
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (e: unknown) {
      if (revision !== session.getRevision() || seq !== this._requestSeq) return
      const msg = e instanceof Error ? e.message : '删除失败'
      wx.showToast({ title: msg, icon: 'none' })
    }
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this.loadPosts()
  },
  onLoadMore() { if (!this.data.loadError) this.loadPosts(false) },
  onRetry() { this.loadPosts(this._retryReset) },
})
