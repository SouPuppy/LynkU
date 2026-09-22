// subpkg-chat/pages/chat — 1:1 chat room with polling-based real-time
import type { IMessage, LoadState, IAnonymousChatTarget, IMessageSyncCursor } from '../../../typings/cloudbase'
import { getConversation, sendMessage, setContactBlocked } from '../../../services/messages'
import { acknowledgeMessages } from '../../../services/read-queue'
import { getOpenid, getState, onChange } from '../../../services/session'
import { pollMessages, type MessagePoller } from '../../../services/watch'
import { requireVerified } from '../../../utils/guard'
import { isAnonymous } from '../../../services/anonymous'
import { mergeChatMessages } from '../../../services/message-state'

Page({
  data: {
    peerOpenid: '',
    otherName: '',
    chatTitle: '聊天',
    anonymousTarget: null as IAnonymousChatTarget | null,
    myOpenid: '',
    messages: [] as IMessage[],
    inputText: '',
    state: 'idle' as LoadState,
    sending: false,
    pollingActive: false,
    blocked: false,
    navHeight: 0,
    scrollTo: '',
    historyCursor: null as IMessageSyncCursor | null,
    hasMoreHistory: false,
    loadingHistory: false,
    historyError: false,
  },

  _poller: null as MessagePoller | null,
  _requestSeq: 0,
  _syncCursor: null as IMessageSyncCursor | null,
  _pendingMessageId: '',
  _pendingMessageText: '',
  _owner: '',
  _unsubscribe: null as (() => void) | null,

  onLoad(options: Record<string, string | undefined>) {
    if (!requireVerified()) return
    const info = wx.getWindowInfo()
    this.setData({ navHeight: (info.statusBarHeight || 44) + 40 })

    const name = options.name ? decodeURIComponent(options.name) : '聊天'
    const anonymousTarget = this.buildAnonymousTarget(options)
    this.setData({
      peerOpenid: anonymousTarget ? '' : options.peer || '',
      otherName: anonymousTarget ? '匿名用户' : name,
      chatTitle: anonymousTarget ? '匿名聊天' : name,
      anonymousTarget,
    })
    const myOpenid = getOpenid()
    if (myOpenid) {
      this._owner = myOpenid
      this.setData({ myOpenid })
    }
  },

  onShow() {
    if (this._owner && this._owner !== getOpenid()) this.clearPrivateView()
    this._unsubscribe?.()
    this._unsubscribe = onChange(() => {
      if (getState() !== 'verified' || getOpenid() !== this._owner) this.clearPrivateView()
    })
    if (getState() === 'verified' && this.hasChatTarget()) this.loadMessages()
  },

  onHide() {
    this.disposeView()
  },

  disposeView() {
    this._requestSeq += 1
    if (this._poller) this._poller.stop()
    this._poller = null
    this._unsubscribe?.()
    this._unsubscribe = null
  },

  onUnload() {
    this.disposeView()
  },

  clearPrivateView() {
    this.disposeView()
    this._pendingMessageId = ''
    this._pendingMessageText = ''
    this._syncCursor = null
    this.setData({ messages: [], inputText: '', myOpenid: '', peerOpenid: '', anonymousTarget: null,
      historyCursor: null, hasMoreHistory: false, loadingHistory: false, sending: false })
  },

  buildAnonymousTarget(options: Record<string, string | undefined>): IAnonymousChatTarget | null {
    if (options.anon_thread) return { anonymous: true, thread_id: options.anon_thread }
    const type = options.anon_type
    const id = options.anon_id
    // Created once per page opening; retries, foreground returns and sends retain it.
    const initiation_id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2).padEnd(13, '0') + Math.random().toString(36).slice(2).padEnd(13, '0')
    if ((type === 'post' || type === 'comment') && id) {
      return { anonymous: true, type, id, initiation_id }
    }
    if (options.peer && options.existing !== '1' && isAnonymous()) {
      return { anonymous: true, type: 'user', id: options.peer, initiation_id }
    }
    return null
  },

  hasChatTarget() {
    return !!this.data.peerOpenid || !!this.data.anonymousTarget
  },

  async loadMessages() {
    if (getState() !== 'verified') return
    const seq = ++this._requestSeq
    const owner = getOpenid()
    if (!this.hasChatTarget()) return
    this._poller?.stop()
    this._poller = null
    this.setData({ state: 'loading', loadingHistory: false, historyError: false, sending: false })
    try {
      const result = await getConversation(
        this.data.peerOpenid || undefined,
        undefined,
        30,
        this.data.anonymousTarget,
      )
      if (seq !== this._requestSeq || getState() !== 'verified' || getOpenid() !== owner) return
      this.setData({ messages: result.messages, state: 'loaded', historyCursor: result.nextBefore, hasMoreHistory: result.hasMore,
        anonymousTarget: result.chat_target || this.data.anonymousTarget })
      this._syncCursor = result.sync_cursor
      this.scrollToBottom()

      // Mark received messages as read
      const unreadIds = result.messages
        .filter(m => m.to === this.data.myOpenid && m.status !== 'read')
        .map(m => m._id)
      if (unreadIds.length > 0) {
        acknowledgeMessages(this.data.peerOpenid || undefined, unreadIds, this.data.anonymousTarget).catch(() => {
          if (seq === this._requestSeq && getOpenid() === owner) this.setData({ pollingActive: true })
        })
      }

      // Start polling for new messages
      this.startPolling()
    } catch (_) {
      if (seq !== this._requestSeq || getState() !== 'verified' || getOpenid() !== owner) return
      this.setData({ state: 'error' })
    }
  },

  async onLoadEarlier() {
    if (getState() !== 'verified' || this.data.loadingHistory || !this.data.historyCursor || this.data.state !== 'loaded') return
    const seq = this._requestSeq
    const owner = getOpenid()
    const anchor = this.data.messages[0]?._id
    this.setData({ loadingHistory: true, historyError: false })
    try {
      const result = await getConversation(this.data.peerOpenid || undefined, this.data.historyCursor, 30, this.data.anonymousTarget)
      if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
      this.setData({ messages: mergeChatMessages(this.data.messages, result.messages),
        historyCursor: result.nextBefore, hasMoreHistory: result.hasMore, loadingHistory: false,
        scrollTo: anchor ? `msg-${anchor}` : '' })
      const unreadIds = result.messages.filter(message => message.to === owner && message.status !== 'read').map(message => message._id)
      if (unreadIds.length) acknowledgeMessages(this.data.peerOpenid || undefined, unreadIds, this.data.anonymousTarget).catch(() => {
        if (seq === this._requestSeq && getOpenid() === owner) this.setData({ pollingActive: true })
      })
    } catch (_) {
      if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
      this.setData({ loadingHistory: false, historyError: true })
    }
  },

  startPolling() {
    if (this._poller) this._poller.stop()
    const initialCursor = this._syncCursor
    if (!initialCursor) return
    const seq = this._requestSeq
    const owner = getOpenid()

    this._poller = pollMessages(
      this.data.peerOpenid || undefined,
      initialCursor,
      (changes) => {
        if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
        this.setData({ pollingActive: false })
        const messages = mergeChatMessages(this.data.messages, changes)
        this.setData({ messages })
        const unreadIds = changes
          .filter(message => message.to === this.data.myOpenid && message.status !== 'read')
          .map(message => message._id)
        if (unreadIds.length > 0) {
          acknowledgeMessages(this.data.peerOpenid || undefined, unreadIds, this.data.anonymousTarget).catch(() => {
            if (seq === this._requestSeq && getOpenid() === owner) this.setData({ pollingActive: true })
          })
        }
        this.scrollToBottom()
      },
      (_err) => {
        if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
        this.setData({ pollingActive: true })
      },
      this.data.anonymousTarget,
      {
        pending: () => this.data.messages.filter(message => message.from === owner && message.status !== 'read').map(message => message._id),
        apply: readIds => {
          if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
          const ids = new Set(readIds)
          this.setData({ pollingActive: false, messages: this.data.messages.map(message => ids.has(message._id)
            ? { ...message, status: 'read' as const } : message) })
        },
      },
    )
  },

  onInput(e: WechatMiniprogram.Input) {
    if (e.detail.value !== this._pendingMessageText) {
      this._pendingMessageId = ''
      this._pendingMessageText = ''
    }
    this.setData({ inputText: e.detail.value })
  },

  async onSend() {
    if (!requireVerified()) return
    const text = this.data.inputText.trim()
    if (!text || this.data.sending) return

    const myOpenid = getOpenid()
    if (!myOpenid) return

    if (!this._pendingMessageId || this._pendingMessageText !== text) {
      this._pendingMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      this._pendingMessageText = text
    }
    const msgId = this._pendingMessageId
    const seq = this._requestSeq

    this.setData({ sending: true })

    try {
      const result = await sendMessage({
        to: this.data.peerOpenid || undefined,
        target: this.data.anonymousTarget,
        content: text,
        msgId,
      })
      if (seq !== this._requestSeq || getOpenid() !== myOpenid || getState() !== 'verified') return
      if (result.message) {
        this.setData({
          messages: mergeChatMessages(this.data.messages, [result.message]),
          inputText: this.data.inputText.trim() === text ? '' : this.data.inputText,
        })
        this._pendingMessageId = ''
        this._pendingMessageText = ''
        this.scrollToBottom()
      }
    } catch (e: unknown) {
      if (seq !== this._requestSeq || getOpenid() !== myOpenid || getState() !== 'verified') return
      const msg = e instanceof Error ? e.message : '发送失败'
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      if (seq === this._requestSeq && getOpenid() === myOpenid && getState() === 'verified') this.setData({ sending: false })
    }
  },

  onBlockContact() {
    if (!requireVerified() || this.data.blocked || !this.hasChatTarget()) return
    wx.showModal({ title: '屏蔽用户', content: '屏蔽后双方均不能继续通过该用户的普通或匿名会话发送新消息。',
      confirmText: '屏蔽', confirmColor: '#c33', success: async result => {
        if (!result.confirm) return
        const owner = getOpenid(), seq = this._requestSeq
        try {
          await setContactBlocked(this.data.peerOpenid || undefined, this.data.anonymousTarget, true)
          if (seq === this._requestSeq && owner === getOpenid()) {
            this.setData({ blocked: true, inputText: '' })
            wx.showToast({ title: '已屏蔽', icon: 'success' })
          }
        } catch (error) {
          if (seq === this._requestSeq && owner === getOpenid()) wx.showToast({ title: error instanceof Error ? error.message : '屏蔽未完成', icon: 'none' })
        }
      } })
  },

  async onUnblockContact() {
    if (!requireVerified() || !this.data.blocked || !this.hasChatTarget()) return
    const owner = getOpenid(), seq = this._requestSeq
    try {
      await setContactBlocked(this.data.peerOpenid || undefined, this.data.anonymousTarget, false)
      if (seq === this._requestSeq && owner === getOpenid()) this.setData({ blocked: false })
    } catch (error) {
      if (seq === this._requestSeq && owner === getOpenid()) wx.showToast({ title: error instanceof Error ? error.message : '解除屏蔽未完成', icon: 'none' })
    }
  },

  scrollToBottom() {
    // Trigger scroll-into-view via data update
    const len = this.data.messages.length
    if (len > 0) {
      this.setData({ scrollTo: `msg-${this.data.messages[len - 1]._id}` })
    }
  },
})
