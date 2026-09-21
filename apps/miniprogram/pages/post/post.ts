import * as session from '../../services/session'
// pages/post — post detail + comments
import type { IPost, ICommentWithReplies, LoadState } from '../../typings/cloudbase'
import { getPost } from '../../services/posts'
import { listCommentsByPost, createComment, deleteComment, buildCommentTree } from '../../services/comments'
import { isAnonymous } from '../../services/anonymous'
import { watchComments, type WatcherHandle } from '../../services/watch'
import { createRequestId, formatTime } from '../../utils/util'
import { requireLogin, requireVerified } from '../../utils/guard'

Page({
  data: {
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

  _watcher: null as WatcherHandle | null,
  _postSeq: 0,
  _commentSeq: 0,
  _commentRequestId: '',

  onLoad(options: Record<string, string | undefined>) {
    const windowInfo = wx.getWindowInfo()
    this.setData({ navHeight: (windowInfo.statusBarHeight || 44) + 40 })
    if (options.id) {
      this.setData({ postId: options.id })
      this.loadPost()
      this.loadComments()
    }
  },

  onShow() {
    this.setData({ access: session.getState() })
    if (this.data.postId) {
      this.startWatch()
    }
  },

  onHide() {
    this.stopWatch()
  },

  onUnload() {
    this.stopWatch()
  },

  async loadPost() {
    const seq = ++this._postSeq
    this.setData({ state: 'loading' })
    try {
      const post = await getPost(this.data.postId)
      if (seq !== this._postSeq) return
      this.setData({
        post,
        postDisplayTime: post ? formatTime(post.created_at) : '',
        state: post ? 'loaded' : 'empty',
      })
    } catch (_) {
      if (seq !== this._postSeq) return
      this.setData({ state: 'error' })
    }
  },

  async loadComments(reset = true, options: { clear?: boolean } = {}) {
    const seq = ++this._commentSeq
    if (reset && (options.clear || this.data.comments.length === 0)) {
      this.setData({ commentState: 'loading', comments: [], commentHasMore: true })
    } else if (reset) {
      this.setData({ commentHasMore: true })
    }
    else this.setData({ commentLoadingMore: true })
    try {
      const flat = reset ? [] : this.flattenComments(this.data.comments)
      const result = await listCommentsByPost(this.data.postId, flat.length)
      const comments = buildCommentTree([...flat, ...result.items])
      if (seq !== this._commentSeq) return
      this.setData({
        comments,
        commentHasMore: !!result.hasMore,
        commentLoadingMore: false,
        commentState: comments.length === 0 ? 'empty' : 'loaded',
      })
    } catch (_) {
      if (seq !== this._commentSeq) return
      this.setData({
        commentLoadingMore: false,
        commentState: this.data.comments.length === 0 ? 'error' : 'loaded',
      })
    }
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

    this.setData({ submitting: true })
    try {
      if (!this._commentRequestId) this._commentRequestId = createRequestId()
      await createComment({ postId: this.data.postId, content, anonymous: isAnonymous(), requestId: this._commentRequestId })
      this._commentRequestId = ''
      this.setData({ inputValue: '', inputFocus: false })
      this.loadComments(true)
      wx.showToast({ title: '评论成功', icon: 'success', duration: 1500 })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '评论失败'
      wx.showToast({ title: msg, icon: 'error' })
    } finally {
      this.setData({ submitting: false })
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

    this.setData({ submitting: true })
    try {
      if (!this._commentRequestId) this._commentRequestId = createRequestId()
      await createComment({ postId: this.data.postId, content, parentId, anonymous: isAnonymous(), requestId: this._commentRequestId })
      this._commentRequestId = ''
      this.setData({
        replyingTo: null,
        replyingToName: '',
        inputValue: '',
        inputPlaceholder: '写评论...',
        inputFocus: false,
      })
      this.loadComments(true)
      wx.showToast({ title: '回复成功', icon: 'success', duration: 1500 })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '回复失败'
      wx.showToast({ title: msg, icon: 'error' })
    } finally {
      this.setData({ submitting: false })
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

    wx.showModal({
      title: '删除评论',
      content: '确定要删除这条评论吗？',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteComment(commentId)
          this.loadComments(true)
          wx.showToast({ title: '已删除', icon: 'success', duration: 1500 })
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : '删除失败'
          wx.showToast({ title: msg, icon: 'error' })
        }
      },
    })
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

  flattenComments(comments: ICommentWithReplies[]) {
    return comments.flatMap(comment => {
      const { replies, ...parent } = comment
      return [parent, ...(replies || [])]
    })
  },

  // ── Real-time watch ──

  startWatch() {
    if (this._watcher) return // already watching
    try {
      this._watcher = watchComments(
        this.data.postId,
        (_docs, changes) => {
          this._commentSeq += 1
          const flat = this.flattenComments(this.data.comments)
          const byId = new Map(flat.map(comment => [comment._id, comment]))
          for (const change of changes) {
            if (change.type === 'remove') byId.delete(change.doc._id)
            else byId.set(change.doc._id, change.doc)
          }
          const comments = buildCommentTree(Array.from(byId.values()))
          this.setData({ comments, commentState: comments.length === 0 ? 'empty' : 'loaded' })
        },
        (err) => {
          console.error('[post] watchComments error:', err.message)
        },
      )
    } catch (_) { /* watch may not be available in all envs */ }
  },

  stopWatch() {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  },

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
