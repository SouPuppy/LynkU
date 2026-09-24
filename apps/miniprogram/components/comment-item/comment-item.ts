import { requireLogin, requireVerified } from '../../utils/guard'
// components/comment-item — top-level comment with one-level replies
import { formatTime } from '../../utils/util'
import type { IComment, ICommentWithReplies } from '../../typings/cloudbase'

const ANONYMOUS_NAME = '匿名用户'
import { ANONYMOUS_AVATAR } from '../../generated/contracts/index'

interface CommentForView extends IComment {
  display_time: string
}

interface CommentThreadForView extends CommentForView {
  replies: CommentForView[]
  reply_count_text: string
}

function normalizeCommentForView(comment: IComment): CommentForView {
  const author = comment.anonymous
    ? {
      ...(comment.author || {}),
      nickname: ANONYMOUS_NAME,
      avatar_url: ANONYMOUS_AVATAR,
    }
    : {
      ...(comment.author || {}),
      nickname: comment.author && comment.author.nickname ? comment.author.nickname : '用户',
      avatar_url: comment.author && comment.author.avatar_url ? comment.author.avatar_url : '',
    }

  return {
    ...comment,
    author,
    display_time: formatTime(comment.created_at),
  }
}

function toCommentThread(value: WechatMiniprogram.IAnyObject | null): ICommentWithReplies | null {
  if (!value || typeof value._id !== 'string' || typeof value.post_id !== 'string' || !value.author) return null
  return value as ICommentWithReplies
}

Component({
  data: {
    viewComment: null as CommentThreadForView | null,
  },

  properties: {
    comment: {
      type: Object,
      value: null,
      observer(value: WechatMiniprogram.IAnyObject | null) {
        const comment = toCommentThread(value)
        if (!comment) {
          this.setData({ viewComment: null })
          return
        }
        const replies = (comment.replies || []).map(reply => normalizeCommentForView(reply))
        this.setData({
          viewComment: {
            ...normalizeCommentForView(comment),
            replies,
            reply_count_text: `${replies.length} 条回复`,
          },
        })
      },
    },
  },

  methods: {
    onReplyTap() {
      const comment = toCommentThread((this.properties as { comment?: WechatMiniprogram.IAnyObject | null }).comment || null)
      if (comment) this.triggerEvent('reply', { commentId: comment._id, authorName: comment.author.nickname })
    },

    onDelete(e: WechatMiniprogram.TouchEvent) {
      const commentId = (e.currentTarget.dataset as { id?: string }).id
      if (commentId) this.triggerEvent('delete', { commentId })
    },

    onReport(e: WechatMiniprogram.TouchEvent) {
      const commentId = (e.currentTarget.dataset as { id?: string }).id
      if (commentId) this.triggerEvent('report', { commentId })
    },

    onAuthorTap(e: WechatMiniprogram.TouchEvent) {
      const dataset = e.currentTarget.dataset as {
        authorId?: string
        anonymous?: boolean
        commentId?: string
        isMine?: boolean
      }
      const authorId = dataset.authorId
      const anonymous = dataset.anonymous
      if (anonymous) {
        if (!requireVerified()) return
        if (!dataset.commentId || dataset.isMine) return
        wx.navigateTo({
          url: `/subpkg-chat/pages/chat/chat?anon_type=comment&anon_id=${encodeURIComponent(dataset.commentId)}&name=${encodeURIComponent('匿名用户')}`,
        })
        return
      }
      if (!authorId || !requireLogin()) return
      wx.navigateTo({ url: `/pages/user/user?openid=${encodeURIComponent(authorId)}` })
    },

  },
})
