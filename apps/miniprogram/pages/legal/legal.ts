import { legalDocumentKind } from '../../generated/contracts/index'
import type { LegalDocument } from '../../generated/contracts/index'
import { legalPolicies } from '../../generated/legal-policies'
import { APP_VERSION } from '../../generated/version'

Page({
  data: {
    title: `关于 ${legalPolicies.appName}`,
    appName: legalPolicies.appName,
    document: null as LegalDocument | null,
    supportEmail: legalPolicies.supportEmail,
    filingNumber: legalPolicies.filingNumber,
    appVersion: APP_VERSION,
    error: '',
  },
  onLoad(options: Record<string, string | undefined>) {
    const kind = legalDocumentKind(options.kind ?? 'about')
    if (!kind) {
      this.setData({ error: '页面不存在，请返回后重新打开。' })
      return
    }
    const document = legalPolicies.documents[kind]
    this.setData({ title: document.title, document })
  },
  openDocument(event: WechatMiniprogram.TouchEvent) {
    const kind = legalDocumentKind(event.currentTarget.dataset.kind)
    if (kind && kind !== 'about') wx.navigateTo({ url: `/pages/legal/legal?kind=${kind}` })
  },
  openWechatPrivacy() {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂时无法打开，请稍后重试', icon: 'none' }),
    })
  },
})
