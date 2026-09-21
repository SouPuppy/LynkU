import { formatTime, truncate } from '../../utils/util'

const ANONYMOUS_NAME = '匿名用户'

type PostPreview = {
  created_at?: string
  content?: string
  author?: { nickname?: string }
  anonymous?: boolean
  comment_count?: number
  view_count?: number
}

Component({
  data: {
    displayTime: '',
    displayExcerpt: '',
    displayAuthorName: '',
    commentCountText: '0 评论',
    viewCountText: '0 阅读',
  },

  properties: {
    post: {
      type: Object,
      value: null,
      observer(post: PostPreview | null) {
        const authorName = post && post.anonymous
          ? ANONYMOUS_NAME
          : (post && post.author && post.author.nickname ? post.author.nickname : '用户')
        const commentCount = post && typeof post.comment_count === 'number' ? post.comment_count : 0
        const viewCount = post && typeof post.view_count === 'number' ? post.view_count : 0
        this.setData({
          displayTime: post && post.created_at ? formatTime(post.created_at) : '',
          displayExcerpt: post ? truncate((post.content || '').replace(/\s+/g, ' '), 88) : '',
          displayAuthorName: authorName,
          commentCountText: `${commentCount} 评论`,
          viewCountText: `${viewCount} 阅读`,
        })
      },
    },
  },
})
