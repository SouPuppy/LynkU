import config from '../config'
export const VERIFICATION_PAUSED = '学校邮箱认证暂不可用，你可以继续浏览；认证恢复后即可申请认证并参与讨论。'
export function openVerification(): void {
  if (config.EMAIL_VERIFICATION_ENABLED) {
    wx.navigateTo({ url: '/pages/email-verify/email-verify' })
    return
  }
  wx.showModal({ title: '学校邮箱认证暂不可用', content: VERIFICATION_PAUSED, showCancel: false, confirmText: '继续浏览' })
}
