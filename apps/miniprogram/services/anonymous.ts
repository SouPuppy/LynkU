import { isLoggedIn } from './session'
// services/anonymous.ts — Anonymous mode state + TabBar theme
// Single owner of 'anonymous_mode' storage key.
// Per design: docs/design/anonymous-mode/

const MODE_KEY = 'anonymous_mode'
export const ANONYMOUS_NAME = '匿名用户'
export const ANONYMOUS_AVATAR = '/assets/anonymous.png'

/** Check if currently in anonymous mode. Defaults to false (real-name). */
export function isAnonymous(): boolean {
  if (!isLoggedIn()) return false
  try {
    return !!wx.getStorageSync(MODE_KEY)
  } catch {
    return false
  }
}

/** Toggle anonymous mode. Returns new state. Applies TabBar theme. */
export function toggle(): boolean {
  const next = !isAnonymous()
  try {
    wx.setStorageSync(MODE_KEY, next)
  } catch (_) { /* non-critical */ }
  applyTabBar(next)
  return next
}

/** Apply TabBar color to match mode. Called on launch and on toggle. */
export function applyTabBar(anonymous?: boolean): void {
  const anon = anonymous ?? isAnonymous()
  const color = anon ? '#8E8E93' : '#1E4D8C'
  try {
    wx.setTabBarStyle({ selectedColor: color })
  } catch (_) { /* may fail if not on tab page */ }
}
