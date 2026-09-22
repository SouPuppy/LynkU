import * as session from '../services/session'
import { openVerification, verificationGuidance } from '../services/verification'
export function openLogin(): void {
  wx.navigateTo({ url: '/pages/login/login?intent=login' })
}
export function requireLogin(): boolean {
  if (session.isLoggedIn()) return true
  wx.showModal({
    title: '登录后继续',
    content: verificationGuidance(),
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
