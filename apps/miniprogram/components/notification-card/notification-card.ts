// components/notification-card — single notification event
import { formatTime } from '../../utils/util'
import type { INotification } from '../../typings/cloudbase'
import { parsePublicNotification } from '../../generated/contracts/index'

const TYPE_LABELS: Record<string, string> = {
  comment: '评论了你的帖子',
  reply: '回复了你的评论',
  like: '赞了你的帖子',
  follow: '关注了你',
  system: '系统通知',
}

function toNotification(value: WechatMiniprogram.IAnyObject | null): INotification | null {
  try { return parsePublicNotification(value) } catch (_) { return null }
}

Component({
  data: {
    actionLabel: '',
    targetPreviewText: '',
    sourceText: '',
    displayTime: '',
  },

  properties: {
    notification: {
      type: Object,
      value: null,
      observer(value: WechatMiniprogram.IAnyObject | null) {
        const notification = toNotification(value)
        const target = notification && notification.target
        const commentPreview = target && target.comment_preview ? String(target.comment_preview) : ''
        const postTitle = target && target.post_title ? String(target.post_title) : ''
        this.setData({
          actionLabel: notification ? TYPE_LABELS[notification.type] || '与你互动了' : '',
          targetPreviewText: commentPreview || postTitle,
          sourceText: commentPreview && postTitle ? `来自：${postTitle}` : '',
          displayTime: notification && notification.created_at ? formatTime(notification.created_at) : '',
        })
      },
    },
  },

  methods: {
    onActorTap(e: WechatMiniprogram.TouchEvent) {
      const actor = (e.currentTarget.dataset as { author?: { _openid?: string } }).author
      const notification = toNotification((this.properties as { notification?: WechatMiniprogram.IAnyObject | null }).notification || null)
      if (!actor || !actor._openid || notification?.anonymous) return
      wx.navigateTo({ url: `/pages/user/user?openid=${actor._openid}` })
    },

    onTap() {
      const n = toNotification((this.properties as { notification?: WechatMiniprogram.IAnyObject | null }).notification || null)
      if (!n) return
      // Deeplink based on notification type
      if (n.type === 'comment' && n.target && n.target.post_id) {
        wx.navigateTo({ url: `/pages/post/post?id=${n.target.post_id}` })
      } else if (n.type === 'reply' && n.target && n.target.post_id) {
        wx.navigateTo({ url: `/pages/post/post?id=${n.target.post_id}` })
      } else if (n.type === 'like' && n.target && n.target.post_id) {
        wx.navigateTo({ url: `/pages/post/post?id=${n.target.post_id}` })
      } else if (n.type === 'follow') {
        // Future: navigate to follower's profile
      }
      // system notifications are non-interactive
    },
  },
})
