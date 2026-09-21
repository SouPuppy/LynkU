// components/search-bar — search bar + category filter + history
interface Category {
  _id: string
  name: string
  slug: string
  color: string
}

Component({
  properties: {
    placeholder: { type: String, value: '搜索帖子...' },
    categories: { type: Array, value: [] as Category[] },
    activeCategoryId: { type: String, value: '' },
    capsuleRight: { type: Number, value: 0 },
  },

  data: {
    keyword: '',
    showHistory: false,
    history: [] as string[],
    inputTimer: null as ReturnType<typeof setTimeout> | null,
  },

  lifetimes: {
    attached() {
      const history = wx.getStorageSync('searchHistory') || []
      this.setData({ history })
    },
    detached() {
      if (this.data.inputTimer) clearTimeout(this.data.inputTimer)
    },
  },

  methods: {
    onInput(e: WechatMiniprogram.Input) {
      const keyword = e.detail.value
      this.setData({ keyword, showHistory: !keyword })
      if (this.data.inputTimer) clearTimeout(this.data.inputTimer)
      this.data.inputTimer = setTimeout(() => {
        this.data.inputTimer = null
        this.triggerEvent('input', { keyword })
      }, 300)
    },

    onFocus() {
      if (!this.data.keyword) {
        this.setData({ showHistory: true })
      }
    },

    onBlur() {
      setTimeout(() => this.setData({ showHistory: false }), 200)
    },

    onClear() {
      this.setData({ keyword: '', showHistory: true })
      this.triggerEvent('input', { keyword: '' })
    },

    onConfirm() {
      this.doSearch(this.data.keyword)
    },

    onHistoryTap(e: WechatMiniprogram.TouchEvent) {
      const keyword = (e.currentTarget.dataset as { key: string }).key
      this.setData({ keyword })
      this.doSearch(keyword)
    },

    onCategoryTap(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as { id: string }).id
      const activeId = id === this.properties.activeCategoryId ? '' : id
      this.triggerEvent('categorychange', { categoryId: activeId })
    },

    onClearHistory() {
      wx.removeStorageSync('searchHistory')
      this.setData({ history: [] })
    },

    doSearch(keyword: string) {
      if (!keyword.trim()) return
      // Save to history (LRU, max 10)
      let history = this.data.history.filter(h => h !== keyword)
      history.unshift(keyword)
      history = history.slice(0, 10)
      this.setData({ history })
      wx.setStorageSync('searchHistory', history)
      this.triggerEvent('search', { keyword })
    },
  },
})
