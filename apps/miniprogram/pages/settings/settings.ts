import { openLogin } from '../../utils/guard'
import { openVerification } from '../../services/verification'
import config from '../../config'
// pages/settings — account settings
import type { IUserPublic } from '../../typings/cloudbase'
import * as session from '../../services/session'
import { updateProfile } from '../../services/users'
import { listContactBlocks, unblockContactOperation } from '../../services/messages'
import type { ContactBlock } from '../../generated/contracts/index'
import { PRESET_AVATARS, isPresetAvatar } from '../../generated/contracts/index'

Page({
  _viewGeneration: 0,
  _unsubscribe: null as (() => void) | null,
  _blockCursor: null as string | null,
  _visible: false,
  _profileSavePending: false,
  data: {
    appName: config.APP_NAME,
    verificationEnabled: config.EMAIL_VERIFICATION_ENABLED,
    user: null as IUserPublic | null,
    editing: false,
    editValue: '',
    saving: false,
    avatarEditing: false,
    avatarOptions: PRESET_AVATARS,
    selectedAvatar: '',
    avatarError: '',
    blocksOpen: false,
    blocks: [] as ContactBlock[],
    blocksLoading: false,
    blocksError: false,
    blocksMore: false,
  },

  onLogin() { openLogin() },

  onShow() {
    this._visible = true
    this._viewGeneration += 1
    this.setData({ user: session.get(), saving: this._profileSavePending, editing: false, avatarEditing: false,
      selectedAvatar: '', avatarError: '', editValue: '', blocksOpen: false, blocks: [], blocksLoading: false })
    this._unsubscribe?.()
    this._unsubscribe = session.onChange(() => {
      if (session.getOpenid() === this.data.user?._openid) { this.setData({ user: session.get() }); return }
      this._viewGeneration++
      this.setData({ user: session.get(), editing: false, avatarEditing: false, selectedAvatar: '', avatarError: '',
        blocksOpen: false, blocks: [], blocksLoading: false })
    })
  },

  onHide() { this._visible = false; this._viewGeneration += 1; this._unsubscribe?.(); this._unsubscribe = null },
  onUnload() { this.onHide() },

  async onBlocks() {
    this.setData({ blocksOpen: !this.data.blocksOpen })
    if (this.data.blocksOpen) { this._blockCursor = null; this.setData({ blocks: [] }); await this.loadBlocks() }
  },
  async loadBlocks() {
    if (this.data.blocksLoading || session.getState() !== 'verified') return
    const generation = this._viewGeneration, revision = session.getRevision()
    this.setData({ blocksLoading: true, blocksError: false })
    try {
      const result = await listContactBlocks(this._blockCursor || undefined)
      if (generation !== this._viewGeneration || revision !== session.getRevision()) return
      this._blockCursor = result.nextCursor
      const items = new Map(this.data.blocks.map(item => [item.id, item]))
      for (const item of result.items) items.set(item.id, item)
      this.setData({ blocks: [...items.values()], blocksMore: !!result.nextCursor })
    } catch (_) {
      if (generation === this._viewGeneration && revision === session.getRevision()) this.setData({ blocksError: true })
    } finally {
      if (generation === this._viewGeneration && revision === session.getRevision()) this.setData({ blocksLoading: false })
    }
  },
  async onUnblock(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (typeof id !== 'string' || session.getState() !== 'verified') return
    const generation = this._viewGeneration, revision = session.getRevision()
    const result = await wx.showModal({ title: '解除这次屏蔽？', content: '将撤销你在该会话中设置的屏蔽。', confirmText: '解除屏蔽' })
    if (!result.confirm || generation !== this._viewGeneration || revision !== session.getRevision()) return
    try {
      await unblockContactOperation(id)
      if (generation === this._viewGeneration && revision === session.getRevision()) this.setData({ blocks: this.data.blocks.filter(item => item.id !== id) })
    } catch (_) {
      if (generation === this._viewGeneration && revision === session.getRevision()) wx.showToast({ title: '解除未完成，请重试', icon: 'none' })
    }
  },

  // ── Edit nickname ──

  onEditAvatar() {
    if (!this.data.user || this._profileSavePending) return
    this.setData({ editing: false, avatarEditing: true, avatarError: '',
      selectedAvatar: isPresetAvatar(this.data.user.avatar_url) ? this.data.user.avatar_url : '' })
  },
  onAvatarSelect(e: WechatMiniprogram.TouchEvent) {
    const src = e.currentTarget.dataset.src
    if (this._profileSavePending || !isPresetAvatar(src)) return
    this.setData({ selectedAvatar: src, avatarError: '' })
  },
  onAvatarCancel() {
    if (this._profileSavePending) return
    this.setData({ avatarEditing: false, selectedAvatar: '', avatarError: '' })
  },
  async onAvatarSave() {
    const avatar_url = this.data.selectedAvatar
    if (!this.data.user || !isPresetAvatar(avatar_url) || this._profileSavePending
      || avatar_url === this.data.user.avatar_url) return
    const generation = this._viewGeneration
    this._profileSavePending = true
    this.setData({ saving: true, avatarError: '' })
    try {
      const updated = await updateProfile({ avatar_url })
      if (generation !== this._viewGeneration || session.getOpenid() !== updated._openid) return
      this.setData({ user: updated, avatarEditing: false })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (_) {
      if (generation === this._viewGeneration) this.setData({ avatarError: '暂未确认保存，请重试' })
    } finally { this.finishProfileSave() }
  },
  finishProfileSave() {
    this._profileSavePending = false
    if (this._visible) this.setData({ saving: false })
  },

  onEditProfile() {
    const user = this.data.user
    if (!user || this._profileSavePending) return
    this.setData({ editing: true, avatarEditing: false, editValue: user.nickname })
  },

  onEditCancel() {
    if (this._profileSavePending) return
    this.setData({ editing: false, editValue: '' })
  },

  onEditInput(e: WechatMiniprogram.Input) {
    this.setData({ editValue: e.detail.value })
  },

  async onEditSave() {
    const nickname = this.data.editValue.trim()
    if (!nickname || !this.data.user || this._profileSavePending) return
    if (nickname === this.data.user?.nickname) {
      this.setData({ editing: false })
      return
    }
    this._profileSavePending = true
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
    } finally { this.finishProfileSave() }
  },

  // ── Navigation ──

  onVerifyEmail() {
    openVerification()
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/legal/legal?kind=about' })
  },
  onReports() { wx.navigateTo({ url: '/pages/reports/reports' }) },

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
