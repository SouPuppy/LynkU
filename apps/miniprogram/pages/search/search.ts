// pages/search — full-text search over posts
import type { IPost, LoadState } from '../../typings/cloudbase'
import { createPostList } from '../../composition/post-list'
import type { PostListController } from '../../features/content/index'

Page({
  data: {
    keyword: '',
    results: [] as IPost[],
    state: 'idle' as LoadState,
    hasMore: true,
    loadingMore: false,
    skRows4: [1, 2, 3, 4],
  },

  _list: null as PostListController | null,
  list(): PostListController {
    if (!this._list) this._list = createPostList('search', state => this.setData({ results: state.items,
      state: state.state, hasMore: state.hasMore, loadingMore: state.loadingMore }))
    return this._list
  },
  _query: '',

  onLoad(options: Record<string, string | undefined>) {
    if (options.keyword) {
      this.setData({ keyword: options.keyword })
      this.search(true)
    }
  },

  onSearch(e: WechatMiniprogram.CustomEvent) {
    const keyword = e.detail.keyword
    const keywordChanged = keyword !== this._query
    this.setData({ keyword })
    this.search(true, { clear: keywordChanged })
  },

  async search(reset = false, _options: { clear?: boolean } = {}) {
    if (reset) {
      const query = this.data.keyword.trim()
      if (!query) return
      this._query = query
      await this.list().select(query)
    } else await this.list().more()
  },

  onLoadMore() { void this.search() },
  onRefresh() { void this.list().refresh() },
  onShow() { this.list().show() },
  onHide() { this.list().hide() },
  onUnload() { this._list?.dispose() },

  onItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/post/post?id=${id}` })
  },

  onInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ keyword: e.detail.keyword })
  },
})
