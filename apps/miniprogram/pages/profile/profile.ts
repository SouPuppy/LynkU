// pages/profile — user center (navigation hub)
import type { IUserPublic } from '../../typings/cloudbase'
import { openLogin, requireVerified } from '../../utils/guard'
import { openVerification } from '../../services/verification'
import config from '../../config'
import * as session from '../../services/session'
import * as anonymous from '../../services/anonymous'
import { refreshMessageBadge } from '../../services/badge'

Page({
  data: {
    verificationEnabled: config.EMAIL_VERIFICATION_ENABLED,
    user: null as IUserPublic | null,
    anonymousMode: false,
    anonymousName: anonymous.ANONYMOUS_NAME,
    anonymousAvatar: anonymous.ANONYMOUS_AVATAR,
  },

  _unsubscribe: null as (() => void) | null,

  onShow() {
    this._unsubscribe?.()
    this._unsubscribe = session.onChange(() => {
      this.setData({ user: session.get(), anonymousMode: anonymous.isAnonymous() })
    })
    refreshMessageBadge().catch(() => {})
    this.setData({
      user: session.get(),
      anonymousMode: anonymous.isAnonymous(),
    })
  },

  onHide() { this._unsubscribe?.(); this._unsubscribe = null },
  onUnload() { this._unsubscribe?.(); this._unsubscribe = null },

  onLogin() { openLogin() },

  onToggleAnonymous() {
    if (!session.isLoggedIn()) return
    const next = anonymous.toggle()
    this.setData({ anonymousMode: next })
    wx.showToast({
      title: next ? '已切换为匿名模式' : '已切换为实名模式',
      icon: 'none',
      duration: 1500,
    })
  },

  onMyPosts() {
    if (!requireVerified()) return
    wx.navigateTo({ url: '/pages/my-posts/my-posts' })
  },

  onVerifyEmail() {
    openVerification()
  },

  onSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
})
