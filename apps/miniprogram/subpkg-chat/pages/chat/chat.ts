// subpkg-chat/pages/chat — 1:1 chat room with polling-based real-time
import type { IMessage, LoadState, IAnonymousChatTarget, IMessageSyncCursor } from '../../../typings/cloudbase'
import { getConversation, getConversationDisplay, setContactBlocked } from '../../../services/messages'
import { createSendRecovery, listPendingConversations } from '../../../services/send-recovery'
import type { SendOperations, SendOperation } from '../../../features/messaging/send-operations'
import { ChatTimeline, type ChatMessageView } from '../../../features/messaging/chat-timeline'
import { createChatDraft, type ChatDraft } from '../../../services/chat-drafts'
import { refreshMessageBadge } from '../../../services/badge'
import { acknowledgeMessages } from '../../../services/read-queue'
import { getOpenid, getRevision, getState, onChange } from '../../../services/session'
import { pollMessages, type MessagePoller } from '../../../services/watch'
import { requireVerified } from '../../../utils/guard'
import { isAnonymous } from '../../../services/anonymous'
import { mergeChatMessages } from '../../../services/message-state'
import { CloudCallError } from '../../../services/cloud'

function chatLoadError(error: unknown): string {
  if (error instanceof CloudCallError) {
    // Codes only: never log peer identities, message bodies or raw SDK responses.
    console.warn('[chat] load failed', error.code)
    if (error.code === 'CHAT_SERVICE_OUTDATED' || error.code === 'UNKNOWN_ACTION') return '聊天服务正在更新，请稍后再试'
    if (error.code === 'NETWORK_ERROR') return '网络连接失败，点击重试'
    if (error.code === 'NOT_FOUND') return '该会话暂不可用，请返回重试'
  }
  return '聊天暂时无法加载，点击重试'
}

Page({
  data: {
    peerOpenid: '',
    otherName: '',
    chatTitle: '聊天',
    anonymousTarget: null as IAnonymousChatTarget | null,
    myOpenid: '',
    messages: [] as IMessage[],
    timeline: [] as ChatMessageView[],
    inputText: '',
    canSend: false,
    inputLength: 0,
    draftWarning: '',
    sendStorageWarning: '',
    sendRecoveryError: '',
    state: 'idle' as LoadState,
    loadError: '',
    pollingActive: false,
    blocked: false,
    blockPending: false,
    identityReady: false,
    identityLoading: false,
    selfAnonymous: false,
    identityNote: '正在确认会话身份…',
    pending: [] as SendOperation[],
    newMessages: 0,
    firstUnreadId: '',
    keyboardHeight: 0,
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
  _sendOperations: null as SendOperations<IMessage> | null,
  _timeline: new ChatTimeline(),
  _timelineDay: '',
  _draft: null as ChatDraft | null,
  _draftRestored: false,
  _editingId: '',
  _established: false,
  _sessionRevision: 0,
  _syncFailures: 0,
  _visible: false,
  _nearBottom: true,
  _observer: null as WechatMiniprogram.IntersectionObserver | null,
  _observedIds: new Set<string>(),
  _owner: '',
  _unsubscribe: null as (() => void) | null,

  onLoad(options: Record<string, string | undefined>) {
    if (!requireVerified()) return
    this._timeline = new ChatTimeline()
    this._observedIds = new Set<string>()
    const info = wx.getWindowInfo()
    this.setData({ navHeight: (info.statusBarHeight || 44) + 40 })

    const name = options.name ? decodeURIComponent(options.name) : '聊天'
    const recovery = options.recover ? listPendingConversations().find(item => item.id === options.recover) : null
    if (options.recover && !recovery) { wx.showToast({ title: '待确认记录已处理', icon: 'none' }); return }
    const anonymousTarget = recovery ? recovery.target : this.buildAnonymousTarget(options)
    this._established = !!options.anon_thread || options.existing === '1' || !!(recovery?.target && 'thread_id' in recovery.target)
    this._sessionRevision = getRevision()
    this.setData({
      peerOpenid: anonymousTarget ? '' : recovery?.peer || options.peer || '',
      otherName: name,
      chatTitle: '聊天',
      anonymousTarget,
    })
    const myOpenid = getOpenid()
    if (myOpenid) {
      this._owner = myOpenid
      this.setData({ myOpenid })
    }
  },

  onShow() {
    this._visible = true
    if (this._owner && (this._owner !== getOpenid() || this._sessionRevision !== getRevision())) {
      this.onSessionChange()
      return
    }
    this._unsubscribe?.()
    this._unsubscribe = onChange(() => this.onSessionChange())
    if (getState() === 'verified' && this.hasChatTarget()) {
      if (this.data.state === 'loaded' && this._syncCursor) {
        void this.resumeConversation()
      } else this.loadMessages()
    }
  },

  onSessionChange() {
    if (getState() !== 'verified' || getOpenid() !== this._owner) { this.clearPrivateView(); return }
    if (getRevision() === this._sessionRevision) return
    const visible = this._visible
    this.disposeView()
    this._sessionRevision = getRevision()
    this._draft = null
    this._sendOperations = null
    this.setData({ identityReady: false, canSend: false, blockPending: false })
    if (visible) this.onShow()
  },

  onHide() {
    this.persistComposer()
    this.setData({ keyboardHeight: 0, blockPending: false })
    this.disposeView()
  },

  async resumeConversation() {
    if (this.data.identityLoading) return
    const seq = this._requestSeq, owner = getOpenid()
    this.setData({ identityReady: false, identityLoading: true, canSend: false })
    try {
      const display = await getConversationDisplay(this.data.peerOpenid || undefined, this.data.anonymousTarget)
      if (!this._visible || seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
      this.setData({ identityReady: true, identityLoading: false, blocked: display.blockedHere, chatTitle: display.peerName,
        selfAnonymous: display.selfVisibility === 'anonymous',
        identityNote: display.selfVisibility === 'anonymous' ? '你以匿名身份参与' : '对方可见你的昵称和头像' })
      this.restoreSendOperations()
      this.restoreComposer()
      this.observeMessages()
      this.startPolling()
    } catch (_) {
      if (this._visible && seq === this._requestSeq && getOpenid() === owner) this.setData({ identityReady: false, identityLoading: false, identityNote: '会话身份暂时无法确认' })
    }
  },

  onIdentityRetry() {
    if (this.data.identityReady || this.data.identityLoading || this.data.state === 'loading') return
    if (!this._syncCursor || this.data.state !== 'loaded') void this.loadMessages()
    else void this.resumeConversation()
  },

  disposeView() {
    this._visible = false
    this._observer?.disconnect()
    this._observer = null
    this._requestSeq += 1
    this.setData({ identityLoading: false, state: this.data.state === 'loading' ? 'idle' : this.data.state })
    if (this._poller) this._poller.stop()
    this._poller = null
    this._unsubscribe?.()
    this._unsubscribe = null
  },

  onUnload() {
    this.persistComposer()
    this.disposeView()
  },

  clearPrivateView() {
    this.disposeView()
    this._sendOperations = null
    this._timeline.clear()
    this._draft = null
    this._draftRestored = false
    this._editingId = ''
    this._established = false
    this._observedIds.clear()
    this._syncCursor = null
    this.setData({ messages: [], timeline: [], inputText: '', inputLength: 0, canSend: false,
      draftWarning: '', sendStorageWarning: '', sendRecoveryError: '', myOpenid: '', peerOpenid: '', anonymousTarget: null,
      historyCursor: null, hasMoreHistory: false, loadingHistory: false, blockPending: false,
      pending: [], identityReady: false, selfAnonymous: false, blocked: false, firstUnreadId: '',
      chatTitle: '聊天', otherName: '', identityNote: '', newMessages: 0 })
  },

  buildAnonymousTarget(options: Record<string, string | undefined>): IAnonymousChatTarget | null {
    if (options.anon_thread) return { anonymous: true, thread_id: options.anon_thread }
    const type = options.anon_type
    const id = options.anon_id
    // Created once per page opening; retries, foreground returns and sends retain it.
    const initiation_id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2).padEnd(13, '0') + Math.random().toString(36).slice(2).padEnd(13, '0')
    if ((type === 'post' || type === 'comment') && id) {
      return { anonymous: true, type, id, initiation_id, initiator_visibility: isAnonymous() ? 'anonymous' : 'real' }
    }
    if (options.peer && options.existing !== '1' && isAnonymous()) {
      return { anonymous: true, type: 'user', id: options.peer, initiation_id, initiator_visibility: 'anonymous' }
    }
    return null
  },

  hasChatTarget() {
    return !!this.data.peerOpenid || !!this.data.anonymousTarget
  },

  async loadMessages() {
    if (getState() !== 'verified' || !this._visible || this.data.state === 'loading') return
    const seq = ++this._requestSeq
    const owner = getOpenid()
    if (!this.hasChatTarget()) return
    this._poller?.stop()
    this._poller = null
    this.setData({ state: 'loading', loadError: '', identityReady: false, identityLoading: true, canSend: false,
      identityNote: '正在确认会话身份…', loadingHistory: false, historyError: false })
    try {
      const result = await getConversation(
        this.data.peerOpenid || undefined,
        undefined,
        30,
        this.data.anonymousTarget,
      )
      if (seq !== this._requestSeq || getState() !== 'verified' || getOpenid() !== owner) return
      if (!result.display) throw new CloudCallError('聊天服务尚未更新', 'CHAT_SERVICE_OUTDATED', 'messages', 'getConversation')
      this.setData({ messages: result.messages, state: 'loaded', historyCursor: result.nextBefore, hasMoreHistory: result.hasMore,
        anonymousTarget: result.chat_target || this.data.anonymousTarget, identityReady: true, identityLoading: false,
        chatTitle: result.display.peerName, otherName: result.display.peerName, blocked: result.display.blockedHere,
        selfAnonymous: result.display.selfVisibility === 'anonymous',
        identityNote: result.display.selfVisibility === 'anonymous' ? '你以匿名身份参与' : '对方可见你的昵称和头像' })
      this._syncCursor = result.sync_cursor
      if (result.messages.length || (result.chat_target && 'thread_id' in result.chat_target)) this._established = true
      if (this.data.anonymousTarget && 'type' in this.data.anonymousTarget) this.setData({ anonymousTarget: {
        ...this.data.anonymousTarget, expected_target_visibility: result.display.peerVisibility,
      } })
      this.restoreSendOperations()
      this.restoreComposer()
      if (result.first_unread_id) {
        this._nearBottom = false
        this.setData({ firstUnreadId: result.first_unread_id, scrollTo: `msg-${result.first_unread_id}` })
      } else this.scrollToBottom()
      this.observeMessages()

      // Start polling for new messages
      this.startPolling()
    } catch (error) {
      if (seq !== this._requestSeq || getState() !== 'verified' || getOpenid() !== owner) return
      this.setData({ state: 'error', identityReady: false, identityLoading: false, loadError: chatLoadError(error), identityNote: '会话身份尚未确认' })
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
      this.renderTimeline()
      this.observeMessages()
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
    this._syncFailures = 0

    this._poller = pollMessages(
      this.data.peerOpenid || undefined,
      initialCursor,
      (changes) => {
        if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
        this.setData({ pollingActive: false })
        const known = new Set(this.data.messages.map(message => message._id))
        const arrived = changes.filter(message => !known.has(message._id) && message.to === owner).length
        const messages = mergeChatMessages(this.data.messages, changes)
        this.setData({ messages })
        for (const message of changes) if (message.from === owner) this._sendOperations?.accept(message)
        if (changes.length && !this._established) { this._established = true; this.restoreComposer() }
        this.renderTimeline()
        if (this._nearBottom) this.scrollToBottom()
        else if (arrived) this.setData({ newMessages: this.data.newMessages + arrived })
        this.observeMessages()
      },
      (_err) => {
        if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
        this._syncFailures += 1
        this.setData({ pollingActive: this._syncFailures >= 2 })
      },
      this.data.anonymousTarget,
      {
        healthy: cursor => {
          if (seq !== this._requestSeq || !this._visible || getOpenid() !== owner) return
          this._syncCursor = cursor
          this._syncFailures = 0
          this.setData({ pollingActive: false })
          if (this._timelineDay !== new Date().toDateString()) this.renderTimeline()
          void this._sendOperations?.recover().catch(() => {})
        },
        pending: () => this.data.messages.filter(message => message.from === owner && message.status !== 'read').map(message => message._id),
        apply: readIds => {
          if (seq !== this._requestSeq || getOpenid() !== owner || getState() !== 'verified') return
          const ids = new Set(readIds)
          this.setData({ pollingActive: false, messages: this.data.messages.map(message => ids.has(message._id)
            ? { ...message, status: 'read' as const } : message) })
          this.renderTimeline()
        },
      },
    )
  },

  onInput(e: WechatMiniprogram.Input) {
    if (!e.detail.value) this._editingId = ''
    this.setComposer(e.detail.value)
  },

  renderTimeline() {
    this._timelineDay = new Date().toDateString()
    this.setData({ timeline: this._timeline.render(this.data.messages, this.data.pending, this.data.myOpenid, Date.now()) })
    this.refreshComposerState()
  },

  refreshComposerState() {
    const replacing = this.data.pending.some(item => item.id === this._editingId && item.state === 'failed' && item.action === 'edit')
    this.setData({ canSend: this.data.identityReady && !this.data.blocked && !!this._sendOperations && !this.data.sendRecoveryError
        && (this.data.pending.length < 20 || replacing) && !!this.data.inputText.trim() && this.data.inputText.length <= 5000 })
  },

  setComposer(text: string) {
    this.setData({ inputText: text, inputLength: text.length })
    this.refreshComposerState()
    this.persistComposer()
  },

  restoreComposer() {
    if (!this._established || !this._syncCursor) return
    try {
      if (!this._draft) this._draft = createChatDraft(this._syncCursor.conversation_id)
      if (!this._draftRestored) {
        const text = this._draft.load()
        this._draftRestored = true
        if (!this.data.inputText) this.setData({ inputText: text, inputLength: text.length })
      }
      this.persistComposer()
    } catch (_) { this.setData({ draftWarning: '输入内容暂未保存，请留在当前页面' }) }
    this.renderTimeline()
  },

  persistComposer() {
    if (!this._draft || !this._draftRestored || getRevision() !== this._sessionRevision || getOpenid() !== this._owner) return
    try { this._draft.save(this.data.inputText); this.setData({ draftWarning: '' }) }
    catch (_) { this.setData({ draftWarning: '输入内容暂未保存，请留在当前页面' }) }
  },

  async onSend() {
    if (!requireVerified()) return
    const text = this.data.inputText.trim()
    if (!this._visible || !text || text.length > 5000 || !this.data.identityReady || this.data.blocked || !this._sendOperations) return

    const myOpenid = getOpenid()
    if (!myOpenid) return

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
    const seq = this._requestSeq
    try {
      // Both steps are synchronous before dispatch: a failed local handoff must retain the composer.
      this._draft?.remove()
      const sending = this._sendOperations.submit(msgId, text, this._editingId || undefined)
      if (this._sendOperations.snapshot().some(item => item.id === msgId)) {
        this._editingId = ''
        this.setData({ inputText: '', inputLength: 0, draftWarning: '' })
        this.renderTimeline()
      } else this.persistComposer()
      this.scrollToBottom()
      await sending
    } catch (e: unknown) {
      if (seq !== this._requestSeq || getOpenid() !== myOpenid || getState() !== 'verified') return
      wx.showToast({ title: '暂时无法发送，输入内容已保留', icon: 'none' })
    }
  },

  restoreSendOperations() {
    if (!this._syncCursor) return
    const seq = this._requestSeq
    this.setData({ sendStorageWarning: '' })
    try {
      this._sendOperations = createSendRecovery(this._syncCursor.conversation_id, this.data.peerOpenid || undefined,
      this.data.anonymousTarget, () => this._visible && seq === this._requestSeq,
      pending => { this.setData({ pending }); this.renderTimeline() }, message => {
        this.setData({ messages: mergeChatMessages(this.data.messages, [message]) })
        this._established = true
        this.restoreComposer()
        this.renderTimeline()
        if (this._nearBottom) this.scrollToBottom()
        this.observeMessages()
        refreshMessageBadge().catch(() => {})
      }, this.data.chatTitle, () => {
        if (this._visible && seq === this._requestSeq) this.setData({ sendStorageWarning: '发送记录暂未保存，请稍后重新进入聊天' })
      })
      this.setData({ pending: this._sendOperations.snapshot(), sendRecoveryError: '' })
      for (const message of this.data.messages) if (message.from === this.data.myOpenid) this._sendOperations.accept(message)
      void this._sendOperations.recover().catch(() => {})
    } catch (_) {
      this._sendOperations = null
      this.setData({ sendRecoveryError: '待发送记录暂时无法读取' })
    }
    this.renderTimeline()
  },

  onRecoveryRetry() { if (this._visible && this.data.identityReady && this.data.sendRecoveryError) this.restoreSendOperations() },

  onRetrySend(e: WechatMiniprogram.TouchEvent) {
    if (!this._visible || !this.data.identityReady || this.data.blocked || !requireVerified()) return
    const seq = this._requestSeq
    const id = e.currentTarget.dataset.id
    if (typeof id === 'string') void this._sendOperations?.retry(id).catch(() => {
      if (this._visible && seq === this._requestSeq) wx.showToast({ title: '发送状态暂未保存，请重试', icon: 'none' })
    })
  },

  onEditSend(e: WechatMiniprogram.TouchEvent) {
    if (!this._visible || !this.data.identityReady || this.data.blocked || !requireVerified()) return
    if (this.data.inputText) { wx.showToast({ title: '请先处理输入框中的内容', icon: 'none' }); return }
    const id: unknown = e.currentTarget.dataset.id
    if (typeof id !== 'string') return
    try {
      const operation = this._sendOperations?.snapshot().find(item => item.id === id && item.state === 'failed' && item.action === 'edit')
      if (!operation) return
      if (!this._draft) {
        // A new anonymous initiation has no independently recoverable composer yet.
        // Retain its original failed operation until replacement submission is durable.
        this._editingId = id
        this.setComposer(operation.text)
        return
      }
      this._draft.save(operation.text)
      const text = this._sendOperations?.editFailed(id)
      if (text) this.setComposer(text)
    } catch (_) { wx.showToast({ title: '发送状态暂未保存，请重试', icon: 'none' }) }
  },

  onDiscardSend(e: WechatMiniprogram.TouchEvent) {
    const id: unknown = e.currentTarget.dataset.id, seq = this._requestSeq
    if (typeof id !== 'string' || !this._visible || !requireVerified()) return
    wx.showModal({ title: '移除未发送消息', content: '这条消息未发送成功。移除后将不再保留在待发送记录中。', confirmText: '移除',
      success: result => {
        if (!result.confirm || !this._visible || seq !== this._requestSeq) return
        try { this._sendOperations?.discard(id) }
        catch (_) { wx.showToast({ title: '暂时无法移除，请重试', icon: 'none' }) }
      } })
  },

  observeMessages() {
    this._observer?.disconnect()
    const seq = this._requestSeq
    wx.nextTick(() => {
      if (!this._visible || seq !== this._requestSeq) return
      this._observer = this.createIntersectionObserver({ observeAll: true, thresholds: [0, 0.01] })
      this._observer.relativeTo('.chat-scroll').observe('.message-row', result => {
        if (!this._visible || seq !== this._requestSeq || result.intersectionRatio <= 0) return
        const id = result.dataset.id
        const message = this.data.messages.find(item => item._id === id)
        if (!message || message.to !== this.data.myOpenid || message.status === 'read' || this._observedIds.has(message._id)) return
        this._observedIds.add(message._id)
        acknowledgeMessages(this.data.peerOpenid || undefined, [message._id], this.data.anonymousTarget)
          .then(() => refreshMessageBadge()).catch(() => { this._observedIds.delete(message._id) })
      })
    })
  },

  onScroll(e: WechatMiniprogram.ScrollViewScroll) {
    const seq = this._requestSeq
    this.createSelectorQuery().select('.chat-scroll').boundingClientRect(rect => {
      if (seq !== this._requestSeq || !this._visible || !rect || Array.isArray(rect)) return
      this._nearBottom = e.detail.scrollHeight - e.detail.scrollTop - rect.height < 80
      if (this._nearBottom && this.data.newMessages) this.setData({ newMessages: 0 })
    }).exec()
  },

  onKeyboardHeight(e: WechatMiniprogram.CustomEvent<{ height: number }>) {
    if (!this._visible || !Number.isFinite(e.detail.height)) return
    this.setData({ keyboardHeight: Math.max(0, e.detail.height) })
    if (this._nearBottom) this.scrollToBottom()
  },

  onBlockContact() {
    if (!this._visible || !this.data.identityReady || this.data.blockPending || !requireVerified() || this.data.blocked || !this.hasChatTarget()) return
    const owner = getOpenid(), seq = this._requestSeq
    this.setData({ blockPending: true })
    wx.showModal({ title: '屏蔽用户', content: '屏蔽后双方均不能继续通过该用户的普通或匿名会话发送新消息。',
      confirmText: '屏蔽', confirmColor: '#c33', success: async result => {
        if (!this._visible || seq !== this._requestSeq || getOpenid() !== owner) return
        if (!result.confirm) { this.setData({ blockPending: false }); return }
        try {
          await setContactBlocked(this.data.peerOpenid || undefined, this.data.anonymousTarget, true)
          if (seq === this._requestSeq && owner === getOpenid()) {
            this.setData({ blocked: true })
            this.renderTimeline()
            wx.showToast({ title: '已屏蔽', icon: 'success' })
          }
        } catch (error) {
          if (seq === this._requestSeq && owner === getOpenid()) wx.showToast({ title: error instanceof Error ? error.message : '屏蔽未完成', icon: 'none' })
        } finally {
          if (seq === this._requestSeq && owner === getOpenid()) this.setData({ blockPending: false })
        }
      }, fail: () => { if (this._visible && seq === this._requestSeq) this.setData({ blockPending: false }) } })
  },

  async onUnblockContact() {
    if (!this._visible || !this.data.identityReady || this.data.blockPending || !requireVerified() || !this.data.blocked || !this.hasChatTarget()) return
    const owner = getOpenid(), seq = this._requestSeq
    this.setData({ blockPending: true })
    try {
      await setContactBlocked(this.data.peerOpenid || undefined, this.data.anonymousTarget, false)
      if (seq === this._requestSeq && owner === getOpenid()) {
        this.setData({ blocked: false })
        this.renderTimeline()
        wx.showToast({ title: '已解除屏蔽', icon: 'success' })
      }
    } catch (error) {
      if (seq === this._requestSeq && owner === getOpenid()) wx.showToast({ title: error instanceof Error ? error.message : '解除屏蔽未完成', icon: 'none' })
    } finally {
      if (seq === this._requestSeq && owner === getOpenid()) this.setData({ blockPending: false })
    }
  },

  scrollToBottom() {
    this._nearBottom = true
    this.setData({ scrollTo: '', newMessages: 0 })
    wx.nextTick(() => { if (this._visible) this.setData({ scrollTo: 'chat-bottom' }) })
  },
})
