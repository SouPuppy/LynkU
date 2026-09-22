import { moderateText, type TextSafetyPort } from '@lynku/server'
import { performance } from 'node:perf_hooks'
import { setTimeout, clearTimeout } from 'node:timers'

/** The SDK camel-cases response field names; normalize only that documented transport representation. */
export function wechatTextSafety(check: TextSafetyPort['check'], owner: string, scene: 1 | 2 | 3) {
  return (content: string) => moderateText({ clock: {
    now: () => performance.now(),
    schedule: (delayMs, callback) => { const timer = setTimeout(callback, delayMs); return () => clearTimeout(timer) },
  }, check: async input => {
    const raw = await check(input)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const row = raw as Record<string, unknown>
    if (row.errcode !== undefined && row.errCode !== undefined && row.errcode !== row.errCode) throw Error('Invalid safety status')
    return { ...row, errcode: row.errcode ?? row.errCode }
  } }, owner, scene, content)
}
