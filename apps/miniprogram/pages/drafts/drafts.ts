// pages/drafts — Draft list
import type { IDraft, LoadState } from '../../typings/cloudbase'
import { listDrafts, deleteDraft } from '../../services/drafts'
import { requireVerified } from '../../utils/guard'
import { formatTime } from '../../utils/util'

Page({
  data: {
    drafts: [] as IDraft[],
    state: 'idle' as LoadState,
    skRows4: [1, 2, 3, 4],
  },

  _requestSeq: 0,

  onShow() {
    if (!requireVerified()) return
    this.loadDrafts()
  },

  async loadDrafts() {
    const seq = ++this._requestSeq
    if (this.data.drafts.length === 0) this.setData({ state: 'loading' })
    try {
      const drafts = (await listDrafts()).map(draft => ({
        ...draft,
        display_time: formatTime(draft.updated_at),
      }))
      if (seq !== this._requestSeq) return
      this.setData({
        drafts,
        state: drafts.length === 0 ? 'empty' : 'loaded',
      })
    } catch (_) {
      if (seq !== this._requestSeq) return
      this.setData({ state: this.data.drafts.length === 0 ? 'error' : 'loaded' })
    }
  },

  onDraftTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/editor/editor?mode=draft&draft_id=${id}` })
  },

  async onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>(resolve => {
      wx.showModal({
        title: '删除草稿',
        content: '确定删除这个草稿吗？',
        confirmText: '删除',
        confirmColor: '#ee0a24',
        success: resolve,
      })
    })
    if (!res.confirm) return

    try {
      await deleteDraft(id)
      const drafts = this.data.drafts.filter(d => d._id !== id)
      this.setData({
        drafts,
        state: drafts.length === 0 ? 'empty' : 'loaded',
      })
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '删除失败'
      wx.showToast({ title: msg, icon: 'none' })
    }
  },

  onRetry() {
    this.loadDrafts()
  },
})
