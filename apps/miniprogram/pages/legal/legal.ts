import { legalDocumentKind } from '../../generated/contracts'
import type { LegalDocument } from '../../generated/contracts'
import { legalPolicies } from '../../generated/legal-policies'
import { APP_VERSION } from '../../generated/version'
import { callCloud } from '../../services/cloud'
import { getRevision } from '../../services/session'

Page({
  data: {
    title: '关于与规则',
    document: null as LegalDocument | null,
    supportEmail: legalPolicies.supportEmail,
    filingNumber: legalPolicies.filingNumber,
    appVersion: APP_VERSION,
    error: '',
    accepting: false,
    accepted: false,
    agreementReady: legalPolicies.documents.terms.status === 'active' && legalPolicies.documents.rules.status === 'active',
  },
  _alive: true,
  _agreementRequestId: '',
  onUnload() { this._alive = false },
  async acceptAgreement() {
    if (this.data.accepting || !this.data.agreementReady) return
    const revision = getRevision()
    this._agreementRequestId ||= `assent-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.setData({ accepting: true, error: '' })
    try {
      const documentVersions = Object.fromEntries(['terms', 'rules'].map(key => {
        const document = legalPolicies.documents[key as 'terms' | 'rules']
        return [key, { version: document.version, hash: document.hash }]
      }))
      const result = await callCloud<unknown>('users', { action: 'acceptAgreement', requestId: this._agreementRequestId, accepted: true, documentVersions })
      if (!this._alive || getRevision() !== revision) return
      if (!result || typeof result !== 'object' || !('accepted' in result) || result.accepted !== true) throw Error('确认结果未收到，请重试')
      this.setData({ accepted: true })
    } catch (_) {
      if (this._alive && getRevision() === revision) this.setData({ error: '协议确认未完成，请稍后重试。你仍可浏览公开内容。' })
    } finally {
      if (this._alive && getRevision() === revision) this.setData({ accepting: false })
    }
  },
  onLoad(options: Record<string, string | undefined>) {
    const kind = legalDocumentKind(options.kind ?? 'about')
    if (!kind) {
      this.setData({ error: '没有找到这份说明，请从关于与规则重新打开。' })
      return
    }
    const document = legalPolicies.documents[kind]
    this.setData({ title: document.title, document })
  },
  openDocument(event: WechatMiniprogram.TouchEvent) {
    const kind = legalDocumentKind(event.currentTarget.dataset.kind)
    if (kind) wx.redirectTo({ url: `/pages/legal/legal?kind=${kind}` })
  },
  copyContact() {
    wx.setClipboardData({ data: this.data.supportEmail,
      fail: () => wx.showToast({ title: '复制失败，可长按邮箱复制', icon: 'none' }) })
  },
  copyFiling() {
    wx.setClipboardData({ data: this.data.filingNumber,
      fail: () => wx.showToast({ title: '复制失败，可长按编号复制', icon: 'none' }) })
  },
  openWechatPrivacy() {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂时无法打开，可先阅读本页隐私政策', icon: 'none' }),
    })
  },
})
