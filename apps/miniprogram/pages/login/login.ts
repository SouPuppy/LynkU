import { ensureLogin } from '../../services/auth'
import * as session from '../../services/session'
import config from '../../config'
Page({
  data: { appName: config.APP_NAME, loading: false, error: '', verificationEnabled: config.EMAIL_VERIFICATION_ENABLED },
  _attempt: 0,
  _returnBack: false,
  _hidden: false,
  onLoad(options: Record<string, string | undefined>) {
    this._returnBack = options.intent === 'login' && getCurrentPages().length > 1
    if (session.isLoggedIn()) this.finish()
    else this.handleLogin()
  },
  onHide() { this._hidden = true; this._attempt += 1; this.setData({ loading: false }) },
  onShow() {
    if (!this._hidden) return
    this._hidden = false
    if (session.isLoggedIn()) this.finish()
    else this.handleLogin()
  },
  onUnload() { this._attempt += 1 },
  finish() {
    if (this._returnBack) wx.navigateBack()
    else wx.switchTab({ url: '/pages/index/index' })
  },
  handleBrowse() {
    this._attempt += 1
    this.finish()
  },
  async handleLogin() {
    if (this.data.loading) return
    const attempt = ++this._attempt
    this.setData({ loading: true, error: '' })
    try {
      await ensureLogin()
      if (attempt !== this._attempt) return
      this.finish()
    } catch (_) {
      if (attempt === this._attempt) this.setData({ error: '微信身份暂时无法获取，请重试，或先浏览公开内容。' })
    } finally {
      if (attempt === this._attempt) this.setData({ loading: false })
    }
  },
})
