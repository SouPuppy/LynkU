import { requireVerified } from '../../utils/guard'
// pages/index — Forum feed: category tabs + post list
import type { IPost, ICategory, LoadState } from '../../typings/cloudbase'
import { listPosts } from '../../services/posts'
import { listCategories } from '../../services/categories'
import { refreshMessageBadge } from '../../services/badge'


const PAGE_SIZE = 20

Page({
  data: {
    posts: [] as IPost[],
    categories: [] as ICategory[],
    activeCategoryId: '',
    state: 'loading' as LoadState,
    errorMsg: '',
    hasMore: true,
    loadingMore: false,
    statusBarHeight: 44,
    headerPaddingRight: 0,
    skRows5: [1, 2, 3, 4, 5],
  },

  _needsRefresh: false,
  _requestSeq: 0,

  onLoad() {
    const info = wx.getWindowInfo()
    const menuButton = wx.getMenuButtonBoundingClientRect()
    this.setData({
      statusBarHeight: info.statusBarHeight || 44,
      headerPaddingRight: info.screenWidth - menuButton.left,
    })
    this.loadCategories()
    this.loadPosts(true)
  },

  onShow() {
    refreshMessageBadge().catch(() => {})
    const pendingCategory = wx.getStorageSync('pending_feed_category') as string
    if (pendingCategory) {
      wx.removeStorageSync('pending_feed_category')
      this.setData({ activeCategoryId: pendingCategory })
      this.loadPosts(true, { clear: true })
    } else if (this._needsRefresh) {
      this._needsRefresh = false
      this.loadPosts(true)
    }
  },

  async loadCategories() {
    try {
      const categories = await listCategories()
      this.setData({ categories })
    } catch (e: unknown) {
      console.error('[index] loadCategories failed:', e)
    }
  },

  async loadPosts(reset?: boolean, options: { clear?: boolean } = {}) {
    // Cancel stale in-flight requests
    const seq = ++this._requestSeq

    if (reset && options.clear) {
      this.setData({ posts: [], hasMore: true, offset: 0 })
    } else if (reset) {
      this.setData({ hasMore: true, offset: 0 })
    }

    if (reset && this.data.posts.length === 0) {
      this.setData({ state: 'loading', errorMsg: '' })
    } else {
      this.setData({ loadingMore: true })
    }

    const currentOffset = reset ? 0 : this.data.posts.length

    try {
      const result = await listPosts({
        categoryId: this.data.activeCategoryId || undefined,
        offset: currentOffset,
        limit: PAGE_SIZE,
      })

      // Stale request — ignore
      if (seq !== this._requestSeq) return

      const posts = reset ? result.items : [...this.data.posts, ...result.items]
      const hasMore = result.hasMore ?? (result.items.length >= PAGE_SIZE && result.items.length > 0)

      this.setData({
        posts,
        hasMore,
        loadingMore: false,
        state: posts.length === 0 ? 'empty' : 'loaded',
      })
    } catch (e: unknown) {
      if (seq !== this._requestSeq) return
      const msg = e instanceof Error ? e.message : '加载失败'
      console.error('[index] loadPosts failed:', msg)
      this.setData({ state: 'error', errorMsg: msg, loadingMore: false })
    }
  },

  onSearch(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: `/pages/search/search?keyword=${e.detail.keyword}` })
  },

  onCategoryChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ activeCategoryId: e.detail.categoryId })
    this.loadPosts(true, { clear: true })
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return
    this.loadPosts()
  },

  onRefresh() {
    this.loadPosts(true)
  },

  onPostTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/post/post?id=${id}` })
  },

  onCreatePost() {
    if (!requireVerified()) return
    wx.navigateTo({
      url: '/pages/editor/editor',
      events: { postChanged: () => { this._needsRefresh = true } },
    })
  },

  onRetry() {
    this.loadPosts(true)
  },
})
