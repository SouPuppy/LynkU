import { listReports, appealReport, type AppealRequest } from '../../services/governance'
import { CloudCallError } from '../../services/cloud'
import { createRequestId } from '../../utils/util'
import * as session from '../../services/session'
import { openLogin } from '../../utils/guard'
import type { ReportCursor, ReportResult } from '../../generated/contracts/index'
type DisplayReport = ReportResult & { statusLabel: string; outcomeLabel: string; dateLabel: string }
const outcomes = { no_violation: '未发现违规', duplicate: '重复举报', hide_post: '违规帖子已下架', remove_comment: '违规评论已移除' }
Page({
  _generation: 0,
  _appealPending: null as { owner: string; request: AppealRequest } | null,
  _appealBusy: false,
  data: { items: [] as DisplayReport[], cursor: null as ReportCursor | null, loading: false, error: '', loggedIn: false, loaded: false, appealBusy: false },
  onShow() { this.refresh() },
  onHide() { this.clear() },
  onUnload() { this.clear() },
  clear() { this._generation += 1; this.setData({ items: [], cursor: null, loading: false, loaded: false, error: '', appealBusy: false }) },
  onLogin() { openLogin() },
  refresh() {
    this.clear()
    this.setData({ loggedIn: !!session.getOpenid() })
    if (session.getOpenid()) void this.load(false)
  },
  onMore() { if (this.data.cursor && !this.data.loading) void this.load(true) },
  onRetry() { if (!this.data.loading) void this.load(this.data.items.length > 0) },
  async onAppeal(event: WechatMiniprogram.TouchEvent) {
    const owner = session.getOpenid(), generation = this._generation
    const id = event.currentTarget.dataset.id
    const item = this.data.items.find(value => value.reportId === id)
    if (!owner || !item || item.status !== 'closed' || item.appealed || this._appealBusy) return
    if (this._appealPending?.owner !== owner) this._appealPending = null
    if (this._appealPending && this._appealPending.request.id !== id) { wx.showToast({ title: '请先确认上一条申诉结果', icon: 'none' }); return }
    this._appealBusy = true; this.setData({ appealBusy: true })
    try {
      if (!this._appealPending) {
        const input = await wx.showModal({ title: '对处理结果提出异议', editable: true, placeholderText: '请说明复核理由（最多1000字）', confirmText: '提交申诉' })
        if (!input.confirm || generation !== this._generation || session.getOpenid() !== owner) return
        const statement = (input.content || '').trim()
        if (!statement || statement.length > 1000) { wx.showToast({ title: '请填写有效的复核理由', icon: 'none' }); return }
        this._appealPending = { owner, request: { id: item.reportId, expectedVersion: item.version, requestId: createRequestId(), statement } }
      }
      await appealReport(this._appealPending.request)
      this._appealPending = null
      if (generation === this._generation && session.getOpenid() === owner) { wx.showToast({ title: '申诉已受理', icon: 'success' }); this.refresh() }
    } catch (error) {
      const definite = error instanceof CloudCallError && ['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'AUTH_FAILED'].includes(error.code)
      if (definite) this._appealPending = null
      if (generation === this._generation && session.getOpenid() === owner) wx.showModal({ title: '申诉未完成', content: definite ? '记录已变化或不满足申诉条件，请刷新后查看。' : '结果尚未确认。再次点击这条记录的申诉按钮，将确认原请求，不会重复受理。', showCancel: false })
    } finally { this._appealBusy = false; if (generation === this._generation && session.getOpenid() === owner) this.setData({ appealBusy: false }) }
  },
  async load(append: boolean) {
    const generation = this._generation, owner = session.getOpenid()
    if (!owner || this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const page = await listReports(append ? this.data.cursor : null)
      if (generation !== this._generation || session.getOpenid() !== owner) return
      const items = page.items.map(item => ({ ...item, statusLabel: item.appealed ? item.status === 'open' ? '申诉已受理，待复核' : '申诉已复核' : item.status === 'open' ? '已受理，待处理' : '已结案',
        outcomeLabel: item.outcome ? outcomes[item.outcome] : '', dateLabel: item.createdAt.slice(0, 10) }))
      const merged = append ? [...this.data.items, ...items] : items
      this.setData({ items: merged.filter((item, index) => merged.findIndex(other => other.reportId === item.reportId) === index), cursor: page.nextCursor, loaded: true })
    } catch {
      if (generation === this._generation && session.getOpenid() === owner) this.setData({ error: '举报记录暂时无法读取，请重试。' })
    } finally { if (generation === this._generation && session.getOpenid() === owner) this.setData({ loading: false }) }
  },
})
