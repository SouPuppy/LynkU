// pages/messages — tabbed view: 私信 (conversations) + 系统消息 (notifications)
import type { IConversation, INotification, LoadState } from '../../typings/cloudbase'
import { listConversations } from '../../services/messages'
import type { ConversationDirectoryCursor } from '../../services/messages'
import { listNotifications, markNotificationsRead, getUnreadCount } from '../../services/notifications'
import type { NotificationCursor } from '../../services/notifications'
import { refreshMessageBadge } from '../../services/badge'
import { openLogin } from '../../utils/guard'
import * as session from '../../services/session'
import { openVerification, verificationGuidance } from '../../services/verification'
import { formatTime } from '../../utils/util'

type TabKey = 'chat' | 'notif'

Page({
  data: {
    verificationGuidance: verificationGuidance(),
    access: 'guest' as session.SessionState,
    activeTab: 'chat' as TabKey,

    // ── Conversations (Tab: 私信) ──
    conversations: [] as IConversation[],
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

  onLoad() {
    const windowInfo = wx.getWindowInfo()
    this.setData({ navHeight: (windowInfo.statusBarHeight || 44) + 40 })
  },

  onShow() {
    this._viewGeneration += 1
    this._unsubscribe?.()
    this._unsubscribe = session.onChange(() => {
      this._conversationSeq += 1
      this._notificationSeq += 1
      this.setData({ access: session.getState(), conversations: [], notifications: [],
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
      this.setData({ conversations: [], notifications: [], notifUnread: 0 })
      return
    }
    // Always refresh conversations and badge. Notifications on tab switch.
    // updateTabBadge is called inside loadConversations/loadNotifBadge after data arrives.
    this.loadConversations()
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
    this._viewGeneration += 1
    this._conversationSeq += 1
    this._notificationSeq += 1
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
  },

  async onTabNotif() {
    if (this.data.activeTab === 'notif') return
    this.setData({ activeTab: 'notif' })
    // Lazy-load notifications when tab first viewed
    if (this.data.notifications.length === 0) {
      this.loadNotifications(true)
    }
    // Mark visible as read
    const unreadIds = this.data.notifications
      .filter(n => !n.read)
      .map(n => n._id)
    if (unreadIds.length > 0) {
      await this.markNotificationIdsRead(unreadIds)
    }
  },

  // ── Conversations ──

  async loadConversations(more = false) {
    if (session.getState() !== 'verified') return
    if (more && (!this.data.chatHasMore || this.data.chatLoadingMore || !this.data.chatCursor)) return
    const seq = ++this._conversationSeq
    const revision = session.getRevision()
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
      if (seq !== this._conversationSeq || revision !== session.getRevision()) return
      const merged = new Map((more ? this.data.conversations : []).map(item => [item.conversationKey, item]))
      for (const item of page) merged.set(item.conversationKey, item)
      const conversations = [...merged.values()]
      this.setData({
        conversations,
        chatCursor: result.nextCursor,
        chatHasMore: result.hasMore,
        chatLoadingMore: false,
        chatState: conversations.length === 0 ? 'empty' : 'loaded',
      })
      this.updateTabBadge()
    } catch (_) {
      if (seq !== this._conversationSeq || revision !== session.getRevision()) return
      this.setData({ chatState: this.data.conversations.length === 0 ? 'error' : 'loaded',
        chatLoadingMore: false, chatLoadError: true })
    }
  },

  // ── Notifications ──

  async loadNotifications(reset?: boolean) {
    if (session.getState() !== 'verified') return
    if (!reset && (this.data.notifLoadingMore || !this.data.notifCursor)) return
    const seq = ++this._notificationSeq
    const revision = session.getRevision()
    this.setData({ notifLoadingMore: true, notifLoadError: false })
    if (reset) {
      if (this.data.notifications.length === 0) {
        this.setData({ notifications: [], notifState: 'loading' })
      }
    }

    try {
      const result = await listNotifications(reset ? undefined : this.data.notifCursor || undefined, 20)

      if (seq !== this._notificationSeq || revision !== session.getRevision()) return
      const byId = new Map((reset ? [] : this.data.notifications).map(item => [item._id, item]))
      for (const item of result.notifications) byId.set(item._id, { ...item, read: item.read || !!byId.get(item._id)?.read })
      const notifications = [...byId.values()]
      this.setData({
        notifications,
        notifHasMore: result.hasMore,
        notifCursor: result.nextCursor,
        notifLoadingMore: false,
        notifState: notifications.length === 0 ? 'empty' : 'loaded',
      })

      // Mark the newly loaded notifications as read
      if (this.data.activeTab === 'notif') {
        const unreadIds = result.notifications
          .filter(n => !n.read)
          .map(n => n._id)
        if (unreadIds.length > 0) {
          await this.markNotificationIdsRead(unreadIds)
        }
      }
    } catch (_) {
      if (seq !== this._notificationSeq || revision !== session.getRevision()) return
      this.setData({
        notifState: this.data.notifications.length === 0 ? 'error' : 'loaded',
        notifLoadingMore: false,
        notifLoadError: true,
      })
    }
  },

  async loadNotifBadge() {
    if (session.getState() !== 'verified') return
    const generation = this._viewGeneration
    const revision = session.getRevision()
    try {
      const unread = await getUnreadCount()
      if (generation !== this._viewGeneration || revision !== session.getRevision()) return
      this.setData({ notifUnread: unread })
      this.updateTabBadge()
    } catch (_) {
      // Best-effort
    }
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

  onNotifRetry() {
    this.loadNotifications(true)
  },
})
