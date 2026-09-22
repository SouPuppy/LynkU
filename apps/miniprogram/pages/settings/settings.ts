import { openLogin } from '../../utils/guard'
import { openVerification } from '../../services/verification'
import config from '../../config'
import { legalDocumentKind } from '../../generated/contracts/index'
// pages/settings — account settings
import type { IUserPublic } from '../../typings/cloudbase'
import * as session from '../../services/session'
import { updateProfile } from '../../services/users'

Page({
  _viewGeneration: 0,
  data: {
    appName: config.APP_NAME,
    verificationEnabled: config.EMAIL_VERIFICATION_ENABLED,
    user: null as IUserPublic | null,
    editing: false,
    editValue: '',
    saving: false,
  },

  onLogin() { openLogin() },

  onShow() {
    this._viewGeneration += 1
    this.setData({ user: session.get(), saving: false, editing: false, editValue: '' })
  },

  onHide() { this._viewGeneration += 1 },
  onUnload() { this._viewGeneration += 1 },

  // ── Edit nickname ──

  onEditProfile() {
    const user = this.data.user
    if (!user) return
    this.setData({ editing: true, editValue: user.nickname })
  },

  onEditCancel() {
    this.setData({ editing: false, editValue: '' })
  },

  onEditInput(e: WechatMiniprogram.Input) {
    this.setData({ editValue: e.detail.value })
  },

  async onEditSave() {
    const nickname = this.data.editValue.trim()
    if (!nickname || this.data.saving) return
    if (nickname === this.data.user?.nickname) {
      this.setData({ editing: false })
      return
    }
    this.setData({ saving: true })
    const generation = this._viewGeneration
    try {
      const updated = await updateProfile({ nickname })
      if (generation !== this._viewGeneration || session.getOpenid() !== updated._openid) return
      this.setData({ user: updated, editing: false, saving: false })
      wx.showToast({ title: '修改成功', icon: 'success' })
    } catch (e: unknown) {
      if (generation !== this._viewGeneration) return
      wx.showToast({ title: e instanceof Error ? e.message : '修改失败', icon: 'error' })
      this.setData({ saving: false })
    }
  },

  // ── Navigation ──

  onVerifyEmail() {
    openVerification()
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/legal/legal?kind=about' })
  },
  onReports() { wx.navigateTo({ url: '/pages/reports/reports' }) },

  onLegal(event: WechatMiniprogram.TouchEvent) {
    const kind = legalDocumentKind(event.currentTarget.dataset.kind)
    if (kind) wx.navigateTo({ url: `/pages/legal/legal?kind=${kind}` })
  },

  handleLogout() {
    wx.showModal({
      title: '清理本地会话',
      content: '将清理本地登录状态并返回首页。账号和邮箱认证保留，下次启动会自动恢复微信身份。',
      success: (res) => {
        if (res.confirm) session.logout()
      },
    })
  },
})
