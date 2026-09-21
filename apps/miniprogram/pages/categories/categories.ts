// pages/categories — category browser
import type { ICategory, LoadState } from '../../typings/cloudbase'
import { listCategories } from '../../services/categories'

Page({
  data: {
    topics: [] as ICategory[],
    state: 'idle' as LoadState,
    skRows4: [1, 2, 3, 4],
  },

  onLoad() {
    this.loadTopics()
  },

  async loadTopics() {
    this.setData({ state: 'loading' })
    try {
      const topics = await listCategories()
      this.setData({ topics, state: 'loaded' })
    } catch (_) {
      this.setData({ state: 'error' })
    }
  },

  onTopicTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.setStorageSync('pending_feed_category', id)
    wx.switchTab({ url: '/pages/index/index' })
  },
})
