// pages/search — full-text search over posts
import type { IPost, LoadState } from '../../typings/cloudbase'
import { searchPosts } from '../../services/posts'

Page({
  data: {
    keyword: '',
    results: [] as IPost[],
    state: 'idle' as LoadState,
    hasMore: true,
    offset: 0,
    loadingMore: false,
    skRows4: [1, 2, 3, 4],
  },

  _requestSeq: 0,

  onLoad(options: Record<string, string | undefined>) {
    if (options.keyword) {
      this.setData({ keyword: options.keyword })
      this.search(true)
    }
  },

  onSearch(e: WechatMiniprogram.CustomEvent) {
    const keyword = e.detail.keyword
    const keywordChanged = keyword !== this.data.keyword
    this.setData({ keyword })
    this.search(true, { clear: keywordChanged })
  },

  async search(reset?: boolean, options: { clear?: boolean } = {}) {
    if (!this.data.keyword.trim()) return
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return
    const seq = ++this._requestSeq
    if (reset && options.clear) this.setData({ results: [], offset: 0 })
    else if (reset && this.data.results.length === 0) this.setData({ results: [], offset: 0 })
    else if (reset) this.setData({ offset: 0 })

    if (reset && this.data.results.length === 0) this.setData({ state: 'loading' })
    else this.setData({ loadingMore: true })

    try {
      const offset = reset ? 0 : this.data.offset
      const result = await searchPosts(this.data.keyword, offset)
      if (seq !== this._requestSeq) return
      const results = reset ? result.items : [...this.data.results, ...result.items]
      this.setData({
        results,
        offset: offset + result.items.length,
        hasMore: result.hasMore ?? result.items.length >= 20,
        loadingMore: false,
        state: results.length === 0 ? 'empty' : 'loaded',
      })
    } catch (_) {
      if (seq !== this._requestSeq) return
      this.setData({ state: this.data.results.length === 0 ? 'error' : 'loaded', loadingMore: false })
    }
  },

  onLoadMore() { this.search() },
  onRefresh() { this.search(true) },

  onItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/post/post?id=${id}` })
  },

  onInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ keyword: e.detail.keyword })
  },
})
