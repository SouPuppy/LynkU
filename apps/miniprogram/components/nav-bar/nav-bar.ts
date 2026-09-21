Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: false },
  },

  data: {
    statusBarHeight: 44,
    navBarHeight: 40,
  },

  lifetimes: {
    attached() {
      const info = wx.getWindowInfo()
      const h = info.statusBarHeight || 44
      this.setData({
        statusBarHeight: h,
        navBarHeight: 40,
      })
    },
  },

  methods: {
    onBack() {
      wx.navigateBack({ delta: 1 })
    },
  },
})
