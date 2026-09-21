// components/feed-list — scroll container + pull-refresh + empty/loading states
Component({
  properties: {
    items: { type: Array, value: [] as unknown[] },
    hasMore: { type: Boolean, value: true },
    loading: { type: Boolean, value: false },
    emptyText: { type: String, value: '暂无内容' },
    loadingText: { type: String, value: '加载中...' },
  },

  methods: {
    onScrollToLower() {
      if (this.properties.loading || !this.properties.hasMore) return
      this.triggerEvent('loadmore')
    },

    onRefresh() {
      this.triggerEvent('refresh')
    },
  },
})
