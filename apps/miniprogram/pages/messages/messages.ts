// pages/messages — tabbed view: 私信 (conversations) + 系统消息 (notifications)
import type { IConversation, INotification, LoadState } from '../../typings/cloudbase'
import { listConversations } from '../../services/messages'
import type { ConversationDirectoryCursor } from '../../services/messages'
import { listNotifications, markNotificationsRead } from '../../services/notifications'
import type { NotificationCursor } from '../../services/notifications'
import { refreshMessageBadge, onMessageSummary } from '../../services/badge'
import { openLogin } from '../../utils/guard'
import * as session from '../../services/session'
import { openVerification, verificationGuidance } from '../../services/verification'
import { formatTime } from '../../utils/util'
import { listPendingConversations, type PendingConversation } from '../../services/send-recovery'

type TabKey = 'chat' | 'notif'

Page({
  data: {
    verificationGuidance: verificationGuidance(),
    access: 'guest' as session.SessionState,
    activeTab: 'chat' as TabKey,

    // ── Conversations (Tab: 私信) ──
    conversations: [] as IConversation[],
    pendingConversations: [] as PendingConversation[],
    chatState: 'loading' as LoadState,
    chatCursor: null as ConversationDirectoryCursor | null,
    chatHasMore: false,
    chatLoadingMore: false,
    chatLoadError: false,

    // ── Notifications (Tab: 系统消息) ──
    notifications: [] as INotification[],
    notifState: 'loading' as LoadState,
    notifUnread: 0,
    notifHasMore: true,
    notifLoadingMore: false,
    notifCursor: null as NotificationCursor | null,
    notifLoadError: false,
    navHeight: 88,
    skRows5: [1, 2, 3, 4, 5],
  },

  _conversationSeq: 0,
  _notificationSeq: 0,
  _viewGeneration: 0,
  _unsubscribe: null as (() => void) | null,
  _summaryUnsubscribe: null as (() => void) | null,
  _observer: null as WechatMiniprogram.IntersectionObserver | null,
  _visible: false,
  _reading: new Set<string>(),
  _chatRetryMore: false,
  _notifRetryReset: true,
  _owner: null as string | null,
  _chatRefreshPending: false,
  _notifRefreshPending: false,
  _chatEpoch: 0,
  _notifEpoch: 0,

  onLoad() {
    const windowInfo = wx.getWindowInfo()
    this.setData({ navHeight: (windowInfo.statusBarHeight || 44) + 40 })
  },

  onShow() {
    this._visible = true
    if (this._owner !== session.getOpenid()) this.setData({ conversations: [], notifications: [], notifUnread: 0, chatCursor: null, notifCursor: null })
    this._owner = session.getOpenid()
    this._summaryUnsubscribe?.()
    this._summaryUnsubscribe = onMessageSummary(summary => {
      if (!this._visible || session.getState() !== 'verified') return
      this.setData({ notifUnread: summary.notifications })
      this.refreshPendingConversations()
      this.loadConversations()
      if (this.data.activeTab === 'notif') this.loadNotifications(true)
    })
    this._viewGeneration += 1
    this._unsubscribe?.()
    this._unsubscribe = session.onChange(() => {
      this._conversationSeq += 1
      this._notificationSeq += 1
      this._reading.clear()
      this.setData({ access: session.getState(), conversations: [], notifications: [], pendingConversations: [],
        notifUnread: 0, chatCursor: null, chatHasMore: false, chatLoadingMore: false,
        notifLoadingMore: false, notifCursor: null })
      if (session.getState() === 'verified') {
        this.loadConversations()
        this.loadNotifBadge()
        if (this.data.activeTab === 'notif') this.loadNotifications(true)
      }
    })
    const access = session.getState()
    this.setData({ access })
    if (access !== 'verified') {
      this._conversationSeq += 1
      this._notificationSeq += 1
      this.setData({ conversations: [], notifications: [], pendingConversations: [], notifUnread: 0 })
      return
    }
    // Always refresh conversations and badge. Notifications on tab switch.
    // updateTabBadge is called inside loadConversations/loadNotifBadge after data arrives.
    this.loadConversations()
    this.refreshPendingConversations()
    this.loadNotifBadge()
    if (this.data.activeTab === 'notif') {
      this.loadNotifications(true)
    }
  },

  onLogin() { openLogin() },
  onVerify() { openVerification() },
  onHide() {
    this.disposeView()
  },

  onUnload() {
    this.disposeView()
  },

  disposeView() {
    this._visible = false
    this._observer?.disconnect()
    this._summaryUnsubscribe?.()
    this._summaryUnsubscribe = null
    this._chatRefreshPending = false
    this._notifRefreshPending = false
    this._viewGeneration += 1
    this._conversationSeq += 1
    this._notificationSeq += 1
    this.setData({ chatLoadingMore: false, notifLoadingMore: false })
    this._unsubscribe?.()
    this._unsubscribe = null
  },

  /** Set tab bar badge to total unread (conversations + notifications) */
  updateTabBadge() {
    refreshMessageBadge().catch(() => {})
  },

  // ── Tab switching ──

  onTabChat() {
    if (this.data.activeTab === 'chat') return
    this.setData({ activeTab: 'chat' })
    this._observer?.disconnect()
    this.loadConversations()
    this.loadNotifBadge()
  },

  async onTabNotif() {
    if (this.data.activeTab === 'notif') return
    this.setData({ activeTab: 'notif' })
    await this.loadNotifications(true)
    this.observeNotifications()
  },

  // ── Conversations ──

  async loadConversations(more = false) {
    if (session.getState() !== 'verified') return
    if (this.data.chatLoadingMore) {
      if (!more) { this._chatRefreshPending = true; this._chatEpoch++ }
      return
    }
    if (more && (!this.data.chatHasMore || this.data.chatLoadingMore || !this.data.chatCursor)) return
    const seq = ++this._conversationSeq
    const revision = session.getRevision()
    const epoch = ++this._chatEpoch
    this._chatRetryMore = more
    this.setData({ chatLoadingMore: true, chatLoadError: false })
    if (this.data.conversations.length === 0) {
      this.setData({ chatState: 'loading' })
    }
    try {
      const result = await listConversations(more ? this.data.chatCursor || undefined : undefined)
      const page = result.conversations.map(conversation => ({
        ...conversation,
        display_time: formatTime(conversation.lastMessage.created_at),
        conversationKey: conversation.chat_target
          ? `anon:${conversation.chat_target.thread_id}`
          : conversation.peer._openid || '',
        peerAnonymous: !!conversation.chat_target && !conversation.peer._openid,
      }))
      if (seq !== this._conversationSeq || revision !== session.getRevision() || epoch !== this._chatEpoch) return
      const merged = new Map(this.data.conversations.map(item => [item.conversationKey, item]))
      for (const item of page) merged.set(item.conversationKey, item)
      const conversations = [...merged.values()].sort((a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime())
      this.setData({
        conversations,
        chatCursor: result.nextCursor,
        chatHasMore: result.hasMore,
        chatLoadingMore: false,
        chatState: conversations.length === 0 ? 'empty' : 'loaded',
      })
    } catch (_) {
      if (seq !== this._conversationSeq || revision !== session.getRevision() || epoch !== this._chatEpoch) return
      this.setData({ chatState: this.data.conversations.length === 0 ? 'error' : 'loaded',
        chatLoadingMore: false, chatLoadError: true })
    } finally {
      if (seq === this._conversationSeq && revision === session.getRevision()) {
        this.setData({ chatLoadingMore: false })
        if (this._chatRefreshPending && this._visible) { this._chatRefreshPending = false; void this.loadConversations() }
      }
    }
  },

  // ── Notifications ──

  async loadNotifications(reset?: boolean) {
    if (session.getState() !== 'verified') return
    if (this.data.notifLoadingMore) {
      if (reset) { this._notifRefreshPending = true; this._notifEpoch++ }
      return
    }
    if (!reset && (this.data.notifLoadingMore || !this.data.notifCursor)) return
    const seq = ++this._notificationSeq
    const revision = session.getRevision()
    const epoch = ++this._notifEpoch
    this._notifRetryReset = !!reset
    this.setData({ notifLoadingMore: true, notifLoadError: false })
    if (reset) {
      if (this.data.notifications.length === 0) {
        this.setData({ notifications: [], notifState: 'loading' })
      }
    }

    try {
      const result = await listNotifications(reset ? undefined : this.data.notifCursor || undefined, 20)

      if (seq !== this._notificationSeq || revision !== session.getRevision() || epoch !== this._notifEpoch) return
      const byId = new Map(this.data.notifications.map(item => [item._id, item]))
      for (const item of result.notifications) byId.set(item._id, { ...item, read: item.read || !!byId.get(item._id)?.read })
      const notifications = [...byId.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b._id.localeCompare(a._id))
      this.setData({
        notifications,
        notifHasMore: result.hasMore,
        notifCursor: result.nextCursor,
        notifLoadingMore: false,
        notifState: notifications.length === 0 ? 'empty' : 'loaded',
      })

      this.observeNotifications()
    } catch (_) {
      if (seq !== this._notificationSeq || revision !== session.getRevision() || epoch !== this._notifEpoch) return
      this.setData({
        notifState: this.data.notifications.length === 0 ? 'error' : 'loaded',
        notifLoadingMore: false,
        notifLoadError: true,
      })
    } finally {
      if (seq === this._notificationSeq && revision === session.getRevision()) {
        this.setData({ notifLoadingMore: false })
        if (this._notifRefreshPending && this._visible) { this._notifRefreshPending = false; void this.loadNotifications(true) }
      }
    }
  },

  async loadNotifBadge() {
    await refreshMessageBadge().catch(() => {})
  },

  observeNotifications() {
    this._observer?.disconnect()
    const generation = this._viewGeneration
    wx.nextTick(() => {
      if (!this._visible || generation !== this._viewGeneration || this.data.activeTab !== 'notif') return
      this._observer = this.createIntersectionObserver({ observeAll: true, thresholds: [0, 0.01] })
      this._observer.relativeTo('.notif-feed').observe('.notification-row', result => {
        if (!this._visible || generation !== this._viewGeneration || this.data.activeTab !== 'notif' || result.intersectionRatio <= 0) return
        const id = result.dataset.id
        if (typeof id !== 'string' || this._reading.has(id) || !this.data.notifications.some(item => item._id === id && !item.read)) return
        this._reading.add(id)
        void this.markNotificationIdsRead([id]).finally(() => { this._reading.delete(id) })
      })
    })
  },

  async markNotificationIdsRead(ids: string[]) {
    if (session.getState() !== 'verified') return
    const generation = this._viewGeneration
    const revision = session.getRevision()
    try {
      await markNotificationsRead(ids)
      if (generation !== this._viewGeneration || revision !== session.getRevision()) return
      const idSet = new Set(ids)
      this.setData({
        notifications: this.data.notifications.map(notification =>
          idSet.has(notification._id) ? { ...notification, read: true } : notification),
      })
      await this.loadNotifBadge()
    } catch (_) {
      // Keep local unread state when the server update fails.
    }
  },

  // ── Events ──

  onConvTap(e: WechatMiniprogram.TouchEvent) {
    const conv = (e.currentTarget.dataset as { conv: IConversation }).conv
    if (conv.chat_target) {
      const name = encodeURIComponent(conv.peer.nickname)
      const thread = encodeURIComponent(conv.chat_target.thread_id)
      wx.navigateTo({
        url: `/subpkg-chat/pages/chat/chat?anon_thread=${thread}&name=${name}`,
      })
      return
    }
    if (!conv.peer._openid) return
    const peer = encodeURIComponent(conv.peer._openid)
    const name = encodeURIComponent(conv.peer.nickname)
    wx.navigateTo({
      url: `/subpkg-chat/pages/chat/chat?peer=${peer}&name=${name}&existing=1`,
    })
  },

  refreshPendingConversations() {
    try { this.setData({ pendingConversations: listPendingConversations() }) } catch (_) {
      wx.showToast({ title: '待确认消息暂时无法读取', icon: 'none' })
    }
  },
  onPendingConversation(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.recovery
    if (typeof id === 'string') wx.navigateTo({ url: `/subpkg-chat/pages/chat/chat?recover=${encodeURIComponent(id)}` })
  },

  onNotifRefresh() {
    this.loadNotifications(true)
  },

  onNotifLoadMore() {
    if (!this.data.notifHasMore || this.data.notifLoadingMore) return
    this.loadNotifications()
  },

  onRetry() {
    this.loadConversations()
  },

  onChatLoadMore() {
    this.loadConversations(true)
  },

  onChatRetryFailed() { this.loadConversations(this._chatRetryMore) },
  onNotifRetryFailed() { this.loadNotifications(this._notifRetryReset) },

  onNotifRetry() {
    this.loadNotifications(true)
  },
})
