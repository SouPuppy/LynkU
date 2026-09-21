import config from '../../config'
import { ensureLogin } from '../../services/auth'
import { sendEmailCode, verifyEmailCode } from '../../services/users'
import * as session from '../../services/session'

interface EmailVerifyData {
  verificationEnabled: boolean
  email: string
  code: string
  sending: boolean
  verifying: boolean
  cooldown: number
  message: string
  error: string
}

const SCHOOL_EMAIL = /^[a-z0-9._%+-]+@nottingham\.edu\.cn$/

Page({
  data: {
    verificationEnabled: config.EMAIL_VERIFICATION_ENABLED,
    email: '',
    code: '',
    sending: false,
    verifying: false,
    cooldown: 0,
    message: '',
    error: '',
  } as EmailVerifyData,

  cooldownTimer: null as ReturnType<typeof setInterval> | null,
  redirectTimer: null as ReturnType<typeof setTimeout> | null,
  _generation: 0,
  _cooldownUntil: 0,

  onShow() {
    this._generation += 1
    this.setData({ sending: false, verifying: false })
    const remaining = Math.max(0, Math.ceil((this._cooldownUntil - Date.now()) / 1000))
    this.setData({ cooldown: remaining })
    if (remaining) this.startCooldown(remaining)
  },

  onHide() { this.cancelPendingView() },

  cancelPendingView() {
    this._generation += 1
    this.stopCooldown()
    if (this.redirectTimer) clearTimeout(this.redirectTimer)
    this.redirectTimer = null
  },

  onBrowse() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onLoad() {
    if (!config.EMAIL_VERIFICATION_ENABLED) return
    const user = session.get()
    if (user?.verified) {
      wx.switchTab({ url: '/pages/index/index' })
      return
    }
    if (user?.email_pending) this.setData({ email: user.email_pending })
  },

  onUnload() {
    this.cancelPendingView()
  },

  stopCooldown() {
    if (!this.cooldownTimer) return
    clearInterval(this.cooldownTimer)
    this.cooldownTimer = null
  },

  normalizeEmail() {
    return this.data.email.trim().toLowerCase()
  },

  validEmail(email: string) {
    return SCHOOL_EMAIL.test(email)
  },

  onEmailInput(event: WechatMiniprogram.Input) {
    this.setData({ email: event.detail.value, error: '', message: '' })
  },

  onCodeInput(event: WechatMiniprogram.Input) {
    this.setData({ code: event.detail.value.replace(/\D/g, '').slice(0, 6), error: '' })
  },

  startCooldown(seconds: number) {
    this.stopCooldown()
    this._cooldownUntil = Date.now() + seconds * 1000
    this.setData({ cooldown: seconds })
    this.cooldownTimer = setInterval(() => {
      const cooldown = Math.max(0, Math.ceil((this._cooldownUntil - Date.now()) / 1000))
      this.setData({ cooldown })
      if (cooldown === 0) this.stopCooldown()
    }, 1000)
  },

  async onSendCode() {
    if (!config.EMAIL_VERIFICATION_ENABLED) return
    const email = this.normalizeEmail()
    if (!this.validEmail(email)) {
      this.setData({ error: '请使用 @nottingham.edu.cn 邮箱', message: '' })
      return
    }
    if (this.data.sending || this.data.verifying || this.data.cooldown > 0) return

    const generation = this._generation
    this.setData({ sending: true, error: '', message: '' })
    try {
      await ensureLogin()
      if (generation !== this._generation) return
      const revision = session.getRevision()
      await sendEmailCode(email)
      if (generation !== this._generation || revision !== session.getRevision()) return
      this.setData({
        email,
        message: '验证码已发送，请查看学校邮箱；如果没有收到，请检查垃圾邮件。',
      })
      this.startCooldown(60)
    } catch (error: unknown) {
      if (generation !== this._generation) return
      this.setData({ error: error instanceof Error ? error.message : '验证码发送失败' })
    } finally {
      if (generation === this._generation) this.setData({ sending: false })
    }
  },

  async onVerify() {
    if (!config.EMAIL_VERIFICATION_ENABLED) return
    if (this.data.sending || this.data.verifying) return
    const email = this.normalizeEmail()
    const code = this.data.code.trim()
    if (!this.validEmail(email)) {
      this.setData({ error: '请使用 @nottingham.edu.cn 邮箱', message: '' })
      return
    }
    if (!/^\d{6}$/.test(code) || this.data.verifying) {
      this.setData({ error: '请输入 6 位验证码', message: '' })
      return
    }

    const generation = this._generation
    this.setData({ verifying: true, error: '', message: '' })
    try {
      await verifyEmailCode(email, code)
      if (generation !== this._generation) return
      wx.showToast({ title: '认证成功', icon: 'success' })
      const revision = session.getRevision()
      this.redirectTimer = setTimeout(() => {
        this.redirectTimer = null
        if (generation === this._generation && revision === session.getRevision()) {
          wx.switchTab({ url: '/pages/index/index' })
        }
      }, 500)
    } catch (error: unknown) {
      if (generation !== this._generation) return
      this.setData({ error: error instanceof Error ? error.message : '邮箱认证失败' })
    } finally {
      if (generation === this._generation) this.setData({ verifying: false })
    }
  },
})
