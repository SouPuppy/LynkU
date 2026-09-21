// pages/notifications — Notification feed
import type { INotification, LoadState } from '../../typings/cloudbase'
import { listNotifications, markNotificationsRead } from '../../services/notifications'
import type { NotificationCursor } from '../../services/notifications'
import * as session from '../../services/session'
import { requireVerified } from '../../utils/guard'

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

  onLoad() {
    const windowInfo = wx.getWindowInfo()
    this.setData({ navHeight: (windowInfo.statusBarHeight || 44) + 40 })
  },

  onShow() {
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
    this._generation += 1
    this._requestSeq += 1
    this._unsubscribe?.()
    this._unsubscribe = null
  },

  async loadNotifications(reset?: boolean) {
    if (session.getState() !== 'verified' || (!reset && (this.data.loadingMore || !this.data.cursor))) return
    const seq = ++this._requestSeq
    const revision = session.getRevision()
    this.setData({ loadingMore: true, loadError: false })
    if (reset) {
      if (this.data.notifications.length === 0) {
        this.setData({ notifications: [], state: 'loading' })
      }
    }

    try {
      const result = await listNotifications(reset ? undefined : this.data.cursor || undefined, PAGE_SIZE)

      if (seq !== this._requestSeq || revision !== session.getRevision()) return
      const byId = new Map((reset ? [] : this.data.notifications).map(item => [item._id, item]))
      for (const item of result.notifications) byId.set(item._id, { ...item, read: item.read || !!byId.get(item._id)?.read })
      const notifications = [...byId.values()]
      this.setData({
        notifications,
        hasMore: result.hasMore,
        cursor: result.nextCursor,
        loadingMore: false,
        state: notifications.length === 0 ? 'empty' : 'loaded',
      })

      // Mark the newly loaded notifications as read
      {
        const unreadIds = result.notifications
          .filter(n => !n.read)
          .map(n => n._id)
        if (unreadIds.length > 0) {
          await this.markIdsRead(unreadIds)
        }
      }
    } catch (_) {
      if (seq !== this._requestSeq || revision !== session.getRevision()) return
      this.setData({
        state: this.data.notifications.length === 0 ? 'error' : 'loaded',
        loadingMore: false,
        loadError: true,
      })
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

  async markVisibleRead() {
    const ids = this.data.notifications.filter(notification => !notification.read).map(notification => notification._id)
    if (ids.length > 0) await this.markIdsRead(ids)
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
    } catch (_) {
      // Keep red dots visible until the server confirms the update.
    }
  },
})
