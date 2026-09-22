import * as session from '../../services/session'
import { createViewScope } from '../../composition/view-scope'
import type { ViewScope } from '../../features/session/view-scope'
import config from '../../config'
// pages/post — post detail + comments
import type { IPost, ICommentWithReplies, LoadState } from '../../typings/cloudbase'
import { getPost } from '../../services/posts'
import { createComment, deleteComment } from '../../services/comments'
import { isAnonymous } from '../../services/anonymous'
import { createCommentThread } from '../../composition/comment-thread'
import type { CommentThreadController } from '../../features/content/index'
import { createRequestId, formatTime } from '../../utils/util'
import { requireLogin, requireVerified } from '../../utils/guard'
import { submitReport } from '../../services/governance'

Page({
  data: {
    verificationEnabled: config.EMAIL_VERIFICATION_ENABLED,
    access: 'guest' as session.SessionState,
    post: null as IPost | null,
    comments: [] as ICommentWithReplies[],
    state: 'idle' as LoadState,
    commentState: 'idle' as LoadState,
    postId: '',
    inputValue: '',
    inputPlaceholder: '写评论...',
    inputFocus: false,
    submitting: false,
    replyingTo: null as string | null,
    replyingToName: '',
    postDisplayTime: '',
    commentHasMore: true,
    commentLoadingMore: false,
    navHeight: 88,
    skRows3: [1, 2, 3],
  },

  _thread: null as CommentThreadController | null,
  thread(): CommentThreadController {
    if (!this._thread) this._thread = createCommentThread(state => this.setData({ comments: state.comments,
      commentState: state.state, commentHasMore: state.hasMore, commentLoadingMore: state.loadingMore }))
    return this._thread
  },
  _postSeq: 0,
  _commentRequestId: '',
  _scope: null as ViewScope | null,

  scope(): ViewScope {
    if (!this._scope) this._scope = createViewScope(visible => {
      this._postSeq++
      this.setData({ access: session.getState(), post: null, comments: [], state: 'idle',
        submitting: false, inputValue: '', replyingTo: null })
      this._commentRequestId = ''
      if (visible && this.data.postId) { void this.loadPost() }
    })
    return this._scope
  },

  onLoad(options: Record<string, string | undefined>) {
    this.scope()
    const windowInfo = wx.getWindowInfo()
    this.setData({ navHeight: (windowInfo.statusBarHeight || 44) + 40 })
    if (options.id) {
      this.setData({ postId: options.id })
    }
  },

  onShow() {
    this.scope().show()
    this.thread().show()
    this.setData({ access: session.getState(), submitting: false })
    if (this.data.postId) {
      void this.loadPost()
      void this.loadComments()
    }
  },

  onHide() {
    this.scope().hide()
    this._postSeq++
    this.stopWatch()
  },

  onUnload() {
    this._scope?.dispose()
    this._thread?.dispose()
    this._postSeq++
    this.stopWatch()
  },

  async loadPost() {
    const token = this.scope().capture()
    const seq = ++this._postSeq
    this.setData({ state: 'loading' })
    try {
      const post = await getPost(this.data.postId)
      if (seq !== this._postSeq || !this.scope().current(token)) return
      this.setData({
        post,
        postDisplayTime: post ? formatTime(post.created_at) : '',
        state: post ? 'loaded' : 'empty',
      })
    } catch (_) {
      if (seq !== this._postSeq || !this.scope().current(token)) return
      this.setData({ state: 'error' })
    }
  },

  async loadComments(reset = true) {
    if (reset) await this.thread().refresh(this.data.postId)
    else await this.thread().more()
  },

  onRequestAccess() { requireVerified() },

  // ── Comment input (top-level) ──

  onCommentInput(e: WechatMiniprogram.Input) {
    this._commentRequestId = ''
    this.setData({ inputValue: e.detail.value })
  },

  async submitComment() {
    if (!requireVerified()) return
    if (this.data.replyingTo) {
      await this.submitReply()
      return
    }

    const content = this.data.inputValue.trim()
    if (!content || this.data.submitting) return

    const token = this.scope().capture()
    this.setData({ submitting: true })
    try {
      if (!this._commentRequestId) this._commentRequestId = createRequestId()
      const result = await createComment({ postId: this.data.postId, content, anonymous: isAnonymous(), requestId: this._commentRequestId })
      if (!this.scope().current(token)) return
      this._commentRequestId = ''
      this.setData({ inputValue: '', inputFocus: false })
      this.loadComments(true)
      wx.showToast({ title: result.flagged ? '已提交，待审核' : '评论成功', icon: result.flagged ? 'none' : 'success', duration: 1500 })
    } catch (e: unknown) {
      if (!this.scope().current(token)) return
      const msg = e instanceof Error ? e.message : '评论失败'
      wx.showToast({ title: msg, icon: 'error' })
    } finally {
      if (this.scope().current(token)) this.setData({ submitting: false })
    }
  },

  // ── Reply ──

  onReplyTap(e: WechatMiniprogram.CustomEvent) {
    if (!requireVerified()) return
    const commentId = e.detail.commentId || (e.currentTarget.dataset as { id?: string }).id
    if (!commentId) return

    const comment = this.findComment(commentId)
    const authorName = e.detail.authorName || (comment && comment.author && comment.author.nickname) || '用户'
    this._commentRequestId = ''
    this.setData({
      replyingTo: commentId,
      replyingToName: authorName,
      inputValue: '',
      inputPlaceholder: `回复 ${authorName}...`,
      inputFocus: true,
    })
  },

  onReplyCancel() {
    this._commentRequestId = ''
    this.setData({
      replyingTo: null,
      replyingToName: '',
      inputValue: '',
      inputPlaceholder: '写评论...',
      inputFocus: false,
    })
  },

  async submitReply() {
    const content = this.data.inputValue.trim()
    const parentId = this.data.replyingTo
    if (!content || !parentId || this.data.submitting) return

    const token = this.scope().capture()
    this.setData({ submitting: true })
    try {
      if (!this._commentRequestId) this._commentRequestId = createRequestId()
      const result = await createComment({ postId: this.data.postId, content, parentId, anonymous: isAnonymous(), requestId: this._commentRequestId })
      if (!this.scope().current(token)) return
      this._commentRequestId = ''
      this.setData({
        replyingTo: null,
        replyingToName: '',
        inputValue: '',
        inputPlaceholder: '写评论...',
        inputFocus: false,
      })
      this.loadComments(true)
      wx.showToast({ title: result.flagged ? '已提交，待审核' : '回复成功', icon: result.flagged ? 'none' : 'success', duration: 1500 })
    } catch (e: unknown) {
      if (!this.scope().current(token)) return
      const msg = e instanceof Error ? e.message : '回复失败'
      wx.showToast({ title: msg, icon: 'error' })
    } finally {
      if (this.scope().current(token)) this.setData({ submitting: false })
    }
  },

  // ── Delete ──

  onCommentLongPress(e: WechatMiniprogram.CustomEvent) {
    if (!session.isLoggedIn()) return
    const commentId = e.detail.commentId || (e.currentTarget.dataset as { id?: string }).id
    if (!commentId) return
    const comment = this.findComment(commentId)
    if (!comment) return
    // Only allow delete of own comments
    if (!comment.is_mine) return

    const token = this.scope().capture()
    wx.showModal({
      title: '删除评论',
      content: '确定要删除这条评论吗？',
      success: async (res) => {
        if (!res.confirm || !this.scope().current(token)) return
        try {
          await deleteComment(commentId)
          if (!this.scope().current(token)) return
          this.loadComments(true)
          wx.showToast({ title: '已删除', icon: 'success', duration: 1500 })
        } catch (e: unknown) {
          if (!this.scope().current(token)) return
          const msg = e instanceof Error ? e.message : '删除失败'
          wx.showToast({ title: msg, icon: 'error' })
        }
      },
    })
  },

  onReportPost() {
    const post = this.data.post
    if (!post || !requireLogin()) return
    this.showReportSheet({ type: 'post', id: post._id })
  },

  onReportComment(e: WechatMiniprogram.CustomEvent) {
    const commentId = e.detail.commentId
    if (typeof commentId !== 'string' || !requireLogin()) return
    this.showReportSheet({ type: 'comment', id: commentId })
  },

  showReportSheet(target: { type: 'post' | 'comment'; id: string }) {
    const reasons = [{ label: '骚扰或侮辱', code: 'HARASSMENT' }, { label: '违法或有害信息', code: 'ILLEGAL_CONTENT' },
      { label: '侵犯隐私', code: 'PRIVACY' }, { label: '诈骗或虚假信息', code: 'FRAUD' }, { label: '其他', code: 'OTHER' }]
    wx.showActionSheet({ itemList: reasons.map(item => item.label), success: async result => {
      const reason = reasons[result.tapIndex]
      if (!reason) return
      const token = this.scope().capture()
      try {
        await submitReport(target, reason.code)
        if (this.scope().current(token)) wx.showToast({ title: '举报已受理', icon: 'success' })
      } catch (error) {
        if (this.scope().current(token)) wx.showToast({ title: error instanceof Error ? error.message : '举报未受理', icon: 'none' })
      }
    } })
  },

  findComment(id: string): ICommentWithReplies | null {
    for (const c of this.data.comments) {
      if (c._id === id) return c
      for (const r of (c.replies || [])) {
        if (r._id === id) return { ...r, replies: [] }
      }
    }
    return null
  },

  stopWatch() { this._thread?.hide() },

  // ── Author tap → chat ──

  onAuthorTap(e: WechatMiniprogram.TouchEvent) {
    if (!requireLogin()) return
    const author = (e.currentTarget.dataset as { author?: { _openid: string }; anonymous?: boolean }).author
    const anonymous = (e.currentTarget.dataset as { anonymous?: boolean }).anonymous
    if (anonymous) {
      if (!requireVerified()) return
      const post = this.data.post
      if (!post || post.is_mine) return
      wx.navigateTo({
        url: `/subpkg-chat/pages/chat/chat?anon_type=post&anon_id=${encodeURIComponent(post._id)}&name=${encodeURIComponent('匿名用户')}`,
      })
      return
    }
    if (!author || !author._openid) return
    wx.navigateTo({ url: `/pages/user/user?openid=${author._openid}` })
  },

  // ── Utils ──

  onRetry() {
    this.loadPost()
    this.loadComments()
  },

  onCommentLoadMore() {
    if (!this.data.commentHasMore || this.data.commentLoadingMore) return
    this.loadComments(false)
  },

})
