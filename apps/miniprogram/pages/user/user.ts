import { requireLogin, requireVerified } from '../../utils/guard'
// pages/user — public user profile: avatar, handle, stats, recent posts
import type { IUserPublic, IPost, LoadState } from '../../typings/cloudbase'
import { getProfile } from '../../services/users'
import { listPosts } from '../../services/posts'
import { getOpenid } from '../../services/session'
import { formatTime } from '../../utils/util'

Page({
  data: {
    profile: null as IUserPublic | null,
    handle: '',
    postCount: null as number | null,
    joinDate: '',
    isSelf: false,
    targetOpenid: '',

    state: 'loading' as LoadState,
    posts: [] as IPost[],
    postState: 'loading' as LoadState,
    hasMore: true,
    loadingMore: false,
    navHeight: 88,
    skRows3: [1, 2, 3],
  },

  _profileSeq: 0,
  _postsSeq: 0,

  onHide() { this._profileSeq += 1; this._postsSeq += 1 },
  onUnload() { this._profileSeq += 1; this._postsSeq += 1 },

  onLoad(options: Record<string, string | undefined>) {
    const windowInfo = wx.getWindowInfo()
    this.setData({ navHeight: (windowInfo.statusBarHeight || 44) + 40 })
    const openid = options.openid || ''
    if (!openid) {
      this.setData({ state: 'error' })
      return
    }
    const myOpenid = getOpenid()
    this.setData({
      targetOpenid: openid,
      handle: openid.substring(0, 10),
      isSelf: openid === myOpenid,
    })
  },

  onShow() {
    if (!requireLogin()) return
    const openid = this.data.targetOpenid
    if (!openid) return
    this.setData({ isSelf: openid === getOpenid() })
    this.loadProfile(openid)
    this.loadPosts(true, openid)
  },

  async loadProfile(openid: string) {
    const seq = ++this._profileSeq
    try {
      const profile = await getProfile(openid)
      if (seq !== this._profileSeq) return
      if (!profile) {
        this.setData({
          profile: null,
          joinDate: '',
          state: 'empty',
        })
        return
      }
      this.setData({
        profile,
        joinDate: profile.created_at ? formatTime(profile.created_at) : '',
        state: 'loaded',
      })
    } catch (_) {
      if (seq !== this._profileSeq) return
      this.setData({ state: 'error' })
    }
  },

  async loadPosts(reset?: boolean, openid?: string) {
    const seq = ++this._postsSeq
    const targetOpenid = openid || this.data.targetOpenid
    if (reset) {
      this.setData({ posts: [], postState: 'loading', postCount: null, loadingMore: false })
    } else {
      this.setData({ loadingMore: true })
    }

    const offset = reset ? 0 : this.data.posts.length

    try {
      const result = await listPosts({
        authorOpenid: targetOpenid,
        offset,
        limit: 20,
      })
      const posts = reset ? result.items : [...this.data.posts, ...result.items]
      if (seq !== this._postsSeq) return
      this.setData({
        posts,
        postCount: result.total,
        postState: posts.length === 0 ? 'empty' : 'loaded',
        hasMore: result.hasMore ?? result.items.length >= 20,
        loadingMore: false,
      })
    } catch (_) {
      if (seq !== this._postsSeq) return
      this.setData({
        postState: this.data.posts.length === 0 ? 'error' : 'loaded',
        loadingMore: false,
      })
    }
  },

  onSendMessage() {
    if (!requireVerified()) return
    const p = this.data.profile
    if (!p) return
    const name = encodeURIComponent(p.nickname)
    const avatar = encodeURIComponent(p.avatar_url || '')
    wx.navigateTo({
      url: `/subpkg-chat/pages/chat/chat?peer=${p._openid}&name=${name}&avatar=${avatar}`,
    })
  },

  onPostTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/post/post?id=${id}` })
  },

  onRetry() {
    this.loadProfile(this.data.targetOpenid)
    this.loadPosts(true)
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.postState === 'loading') return
    this.loadPosts()
  },
})
