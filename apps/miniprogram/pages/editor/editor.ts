import { createEditor } from '../../composition/editor'
import { POST_CONTENT_LIMIT } from '../../generated/contracts/index'
import { initialEditorState, parseEditorRoute, type EditorController, type EditorEvent } from '../../features/editor/index'
import { requireVerified } from '../../utils/guard'

Page({
  data: { ...initialEditorState(), navHeight: 88, contentLimit: POST_CONTENT_LIMIT },
  _editor: null as EditorController | null,
  _navigationTimer: null as ReturnType<typeof setTimeout> | null,

  onLoad(options: Record<string, string | undefined>) {
    if (!requireVerified()) return
    const route = parseEditorRoute(options)
    const info = wx.getWindowInfo()
    this.setData({ navHeight: (info.statusBarHeight || 44) + 40 })
    wx.setNavigationBarTitle({ title: route.mode === 'edit' ? '编辑帖子' : route.mode === 'draft' ? '继续编辑' : '发帖' })
    this._editor = createEditor(route, {
      state: state => { this.setData(state) },
      event: event => { this.onEditorEvent(event) },
    })
    void this._editor.initialize()
  },

  onShow() { if (requireVerified()) this._editor?.show() },
  onHide() { this.cancelNavigation(); this._editor?.hide() },
  onUnload() { this.cancelNavigation(); this._editor?.dispose(); this._editor = null },

  cancelNavigation() {
    if (this._navigationTimer) clearTimeout(this._navigationTimer)
    this._navigationTimer = null
  },

  onEditorEvent(event: EditorEvent) {
    if (event.type === 'notice') {
      wx.showToast({ title: event.message, icon: event.success ? 'success' : 'none' })
    } else if (event.type === 'recovery-available') {
      const editor = this._editor
      wx.showModal({ title: '恢复草稿', content: '上次编辑的内容还未保存，是否恢复？', confirmText: '恢复', cancelText: '丢弃',
        success: result => { if (result.confirm || result.cancel) editor?.resolveRecovery(result.confirm) } })
    } else {
      if (event.type === 'published') {
        try { this.getOpenerEventChannel().emit?.('postChanged') } catch (_) { /* Direct entry has no opener. */ }
      }
      this.cancelNavigation()
      const editor = this._editor
      this._navigationTimer = setTimeout(() => {
        this._navigationTimer = null
        if (editor?.canNavigateBack()) wx.navigateBack()
      }, 1500)
    }
  },

  onTitleInput(event: WechatMiniprogram.Input) { this._editor?.edit('title', event.detail.value) },
  onContentInput(event: WechatMiniprogram.Input) { this._editor?.edit('content', event.detail.value) },
  onCategoryTap(event: WechatMiniprogram.TouchEvent) {
    const value: unknown = event.currentTarget.dataset.id
    if (typeof value === 'string') this._editor?.edit('categoryId', this.data.categoryId === value ? '' : value)
  },
  onAnonymousChange(event: WechatMiniprogram.SwitchChange) { this._editor?.setAnonymous(event.detail.value) },
  async onSubmit() { if (requireVerified()) await this._editor?.submit() },
  onDraftsTap() { wx.navigateTo({ url: '/pages/drafts/drafts' }) },
})
