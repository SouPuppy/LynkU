import { requireVerified } from '../../utils/guard'
// pages/index — Forum feed: category tabs + post list
import type { IPost, ICategory, LoadState } from '../../typings/cloudbase'
import { createPostList } from '../../composition/post-list'
import type { PostListController } from '../../features/content/index'
import { listCategories } from '../../services/categories'
import { refreshMessageBadge } from '../../services/badge'



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
  _list: null as PostListController | null,
  list(): PostListController {
    if (!this._list) this._list = createPostList('feed', state => this.setData({ posts: state.items,
      state: state.state, hasMore: state.hasMore, loadingMore: state.loadingMore, errorMsg: state.error }))
    return this._list
  },
  onHide() { this.list().hide() },
  onUnload() { this._list?.dispose() },

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
    this.list().show()
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

  async loadPosts(reset = false, _options: { clear?: boolean } = {}) {
    if (reset) await this.list().select(this.data.activeCategoryId)
    else await this.list().more()
  },

  onSearch(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: `/pages/search/search?keyword=${encodeURIComponent(e.detail.keyword)}` })
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
