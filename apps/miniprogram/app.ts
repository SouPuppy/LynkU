// app.ts — LynkU
// CloudBase-powered. Identity via context.OPENID, no JWT, no mock.
// Cache management delegated to session.ts.
// Per design: docs/design/user-system-consolidation/

import type { ISelfProfile } from './typings/cloudbase'
import config from './config'
import * as session from './services/session'
import { ensureLogin } from './services/auth'

import { applyTabBar } from './services/anonymous'
import { refreshMessageBadge, setMessageSummaryActive } from './services/badge'
import { setNotificationReadsActive } from './services/notifications'
import { setReadQueueActive } from './services/read-queue'

import { setDraftCleanupActive } from './services/draft-cleanup'

let foreground = false
let badgeTimer: ReturnType<typeof setInterval> | null = null

function startBadgePolling() {
  if (!foreground || badgeTimer || session.getState() !== 'verified') return
  refreshMessageBadge().catch(e => {
    console.warn('[app] badge refresh failed:', e.message || e)
  })
  badgeTimer = setInterval(() => {
    refreshMessageBadge().catch(() => {})
  }, 30000)
}

function stopBadgePolling() {
  if (!badgeTimer) return
  clearInterval(badgeTimer)
  badgeTimer = null
}

export interface IAppOption {
  globalData: {
    openid: string | null
    user: ISelfProfile | null
    online: boolean
    launchReady: boolean
  }
}

App<IAppOption>({
  globalData: {
    openid: null,
    user: null,
    online: true,
    launchReady: false,
  },

  onLaunch() {
    wx.cloud.init({
      env: config.CLOUDBASE_ENV,
      traceUser: true,
    })

    // Restore cached profile via session (single cache owner)
    session.get()

    // Restore the same WeChat account; verification stays server-owned.
    this.globalData.openid = session.getOpenid()
    session.onChange(() => {
      stopBadgePolling()
      applyTabBar()
      if (session.getState() === 'verified') startBadgePolling()
      else wx.removeTabBarBadge({ index: 1 })
    })

    // Apply anonymous theme on launch
    applyTabBar()

    // Network awareness
    wx.getNetworkType().then(res => {
      this.globalData.online = res.networkType !== 'none'
    })
    wx.onNetworkStatusChange(res => {
      this.globalData.online = res.isConnected
      if (foreground && res.isConnected) refreshMessageBadge().catch(() => {})
    })

    ensureLogin().catch(() => {
      console.warn('[app] WeChat identity unavailable; public browsing remains available')
    }).finally(() => { this.globalData.launchReady = true })
  },

  onShow() {
    foreground = true
    setMessageSummaryActive(true)
    setNotificationReadsActive(true)
    setDraftCleanupActive(true)
    setReadQueueActive(true)
    if (session.getState() === 'verified') startBadgePolling()
  },

  onHide() {
    foreground = false
    setMessageSummaryActive(false)
    setNotificationReadsActive(false)
    setDraftCleanupActive(false)
    setReadQueueActive(false)
    stopBadgePolling()
  },
})
