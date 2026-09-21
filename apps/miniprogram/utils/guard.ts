import * as session from '../services/session'
import { openVerification } from '../services/verification'
export function openLogin(): void {
  wx.navigateTo({ url: '/pages/login/login?intent=login' })
}
export function requireLogin(): boolean {
  if (session.isLoggedIn()) return true
  wx.showModal({
    title: '登录后继续',
    content: '登录并完成学校认证后可参与讨论。学校邮箱认证暂不可用，你仍可继续浏览。',
    confirmText: '微信登录', cancelText: '取消',
    success: res => { if (res.confirm) openLogin() },
  })
  return false
}
export function requireVerified(): boolean {
  if (!requireLogin()) return false
  if (session.get()?.verified) return true
  openVerification()
  return false
}
