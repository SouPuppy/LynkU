// pages/notifications — Notification feed
import type { INotification, LoadState } from '../../typings/cloudbase'
import { listNotifications, markNotificationsRead } from '../../services/notifications'
import type { NotificationCursor } from '../../services/notifications'
import * as session from '../../services/session'
import { requireVerified } from '../../utils/guard'
import { onMessageSummary, refreshMessageBadge } from '../../services/badge'

const PAGE_SIZE = 20

Page({
  data: {
    notifications: [] as INotification[],
    state: 'idle' as LoadState,
    hasMore: true,
    loadingMore: false,
    cursor: null as NotificationCursor | null,
    loadError: false,
    navHeight: 88,
    skRows5: [1, 2, 3, 4, 5],
  },

  _requestSeq: 0,
  _generation: 0,
  _unsubscribe: null as (() => void) | null,
  _summaryUnsubscribe: null as (() => void) | null,
  _observer: null as WechatMiniprogram.IntersectionObserver | null,
  _visible: false,
  _reading: new Set<string>(),
  _retryReset: true,
  _owner: null as string | null,
  _refreshPending: false,
  _refreshEpoch: 0,

  onLoad() {
    const windowInfo = wx.getWindowInfo()
    this.setData({ navHeight: (windowInfo.statusBarHeight || 44) + 40 })
  },

  onShow() {
    this._visible = true
    if (this._owner !== session.getOpenid()) this.setData({ notifications: [], cursor: null, loadingMore: false })
    this._owner = session.getOpenid()
    this._summaryUnsubscribe?.()
    this._summaryUnsubscribe = onMessageSummary(() => { if (this._visible) this.loadNotifications(true) })
    this._generation += 1
    this._unsubscribe?.()
    this._unsubscribe = session.onChange(() => {
      this._requestSeq += 1
      this.setData({ notifications: [], cursor: null, loadingMore: false, hasMore: false })
    })
    if (requireVerified()) this.loadNotifications(true)
  },

  onHide() { this.disposeView() },
  onUnload() { this.disposeView() },
  disposeView() {
    this._refreshPending = false
    this._visible = false
    this._observer?.disconnect()
    this._summaryUnsubscribe?.()
    this._reading.clear()
    this.setData({ loadingMore: false })
    this._generation += 1
    this._requestSeq += 1
    this._unsubscribe?.()
    this._unsubscribe = null
  },

  async loadNotifications(reset?: boolean) {
    if (this.data.loadingMore) {
      if (reset) { this._refreshPending = true; this._refreshEpoch++ }
      return
    }
    if (session.getState() !== 'verified' || (!reset && (this.data.loadingMore || !this.data.cursor))) return
    const seq = ++this._requestSeq
    const revision = session.getRevision()
    const epoch = ++this._refreshEpoch
    this._retryReset = !!reset
    this.setData({ loadingMore: true, loadError: false })
    if (reset) {
      if (this.data.notifications.length === 0) {
        this.setData({ notifications: [], state: 'loading' })
      }
    }

    try {
      const result = await listNotifications(reset ? undefined : this.data.cursor || undefined, PAGE_SIZE)

      if (seq !== this._requestSeq || revision !== session.getRevision() || epoch !== this._refreshEpoch) return
      const byId = new Map(this.data.notifications.map(item => [item._id, item]))
      for (const item of result.notifications) byId.set(item._id, { ...item, read: item.read || !!byId.get(item._id)?.read })
      const notifications = [...byId.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b._id.localeCompare(a._id))
      this.setData({
        notifications,
        hasMore: result.hasMore,
        cursor: result.nextCursor,
        loadingMore: false,
        state: notifications.length === 0 ? 'empty' : 'loaded',
      })

      this.markVisibleRead()
    } catch (_) {
      if (seq !== this._requestSeq || revision !== session.getRevision() || epoch !== this._refreshEpoch) return
      this.setData({
        state: this.data.notifications.length === 0 ? 'error' : 'loaded',
        loadingMore: false,
        loadError: true,
      })
    } finally {
      if (seq === this._requestSeq && revision === session.getRevision()) {
        this.setData({ loadingMore: false })
        if (this._refreshPending && this._visible) { this._refreshPending = false; void this.loadNotifications(true) }
      }
    }
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return
    this.loadNotifications()
  },

  onRefresh() {
    this.loadNotifications(true)
  },

  onRetry() {
    this.loadNotifications(true)
  },

  onRetryFailed() { this.loadNotifications(this._retryReset) },

  async markVisibleRead() {
    this._observer?.disconnect()
    const generation = this._generation
    wx.nextTick(() => {
      if (!this._visible || generation !== this._generation) return
      this._observer = this.createIntersectionObserver({ observeAll: true, thresholds: [0, 0.01] })
      this._observer.relativeTo('.notif-feed').observe('.notification-row', result => {
        if (!this._visible || generation !== this._generation || result.intersectionRatio <= 0) return
        const id = result.dataset.id
        if (typeof id !== 'string' || this._reading.has(id) || !this.data.notifications.some(item => item._id === id && !item.read)) return
        this._reading.add(id)
        void this.markIdsRead([id]).finally(() => { this._reading.delete(id) })
      })
    })
  },

  async markIdsRead(ids: string[]) {
    const generation = this._generation
    const revision = session.getRevision()
    try {
      await markNotificationsRead(ids)
      if (generation !== this._generation || revision !== session.getRevision()) return
      const idSet = new Set(ids)
      this.setData({
        notifications: this.data.notifications.map(notification =>
          idSet.has(notification._id) ? { ...notification, read: true } : notification),
      })
      refreshMessageBadge().catch(() => {})
    } catch (_) {
      // Keep red dots visible until the server confirms the update.
    }
  },
})
