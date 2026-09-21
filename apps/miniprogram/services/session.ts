// services/session.ts — Single owner of user profile cache
// All modules read/write user state through this module.
// Cache strategy: globalData (in-memory, most recent) → storage (persistent).
// Per design: docs/design/user-system-consolidation/

import type { ISelfProfile } from '../typings/cloudbase'
import { parseSelfProfile } from '../generated/contracts/index'

const PROFILE_KEY = 'user_profile'
const GUEST_KEY = 'guest_browsing'
// Once explicitly cleared, stale disk contents must not revive this session.
let storageHydrationAllowed = true
let revision = 0
export function getRevision(): number { return revision }

/** Reject responses from a previous login or an older profile mutation. */
export function setIfCurrent(profile: ISelfProfile, expectedRevision: number): void {
  if (revision !== expectedRevision) throw new Error('会话已变更，请重新操作')
  set(profile)
}

function attempt(operation: () => void): void {
  try { operation() } catch { console.warn('[session] local operation failed') }
}

function notify(): void {
  for (const listener of [...listeners]) attempt(listener)
}
export type SessionState = 'guest' | 'unverified' | 'verified'
const listeners = new Set<() => void>()
export function onChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function getState(): SessionState {
  const user = get()
  return !user ? 'guest' : user.verified ? 'verified' : 'unverified'
}

/** Get current user profile. Checks globalData first (most recent), then storage. */
export function get(): ISelfProfile | null {
  try {
    const app = getApp<IAppOption>()
    if (app.globalData.user) return app.globalData.user
    if (!storageHydrationAllowed) return null
    storageHydrationAllowed = false
    const cached = wx.getStorageSync(PROFILE_KEY)
    if (cached) {
      try {
        const profile = parseSelfProfile(cached)
        app.globalData.user = profile
        app.globalData.openid = profile._openid
        return profile
      } catch (_) { attempt(() => wx.removeStorageSync(PROFILE_KEY)) }
    }
    return null
  } catch {
    return null
  }
}

/** Set user profile in both globalData and persistent storage. */
export function set(profile: ISelfProfile): void {
  profile = parseSelfProfile(profile)
  revision += 1
  storageHydrationAllowed = false
  attempt(() => {
    getApp<IAppOption>().globalData.user = profile
    getApp<IAppOption>().globalData.openid = profile._openid
  })
  attempt(() => wx.removeStorageSync(GUEST_KEY))
  attempt(() => wx.setStorageSync(PROFILE_KEY, profile))
  notify()
}

/** Clear user session — removes profile from memory and storage. */
export function clear(): void {
  revision += 1
  storageHydrationAllowed = false
  attempt(() => {
    getApp<IAppOption>().globalData.user = null
    getApp<IAppOption>().globalData.openid = null
  })
  for (const key of [PROFILE_KEY, GUEST_KEY, 'anonymous_mode']) {
    attempt(() => wx.removeStorageSync(key))
  }
  notify()
}

/** Get current user's openid. Convenience — reads from session. */
export function getOpenid(): string | null {
  const profile = get()
  return profile ? profile._openid : null
}

/** Check if user is logged in. */
export function isLoggedIn(): boolean {
  return !!getOpenid()
}

/** Clear the local session and return to public browsing. */
export function logout(): void {
  clear()
  wx.reLaunch({ url: '/pages/index/index' })
}
