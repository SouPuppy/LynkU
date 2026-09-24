import * as session from './session'
import { getUnreadMessageCount } from './messages'
import { getUnreadCount, flushNotificationReads } from './notifications'
import { flushReadAcknowledgements } from './read-queue'

import { flushDraftCleanup } from './draft-cleanup'

export interface MessageSummary { conversations: number; notifications: number; total: number }
const listeners = new Set<(summary: MessageSummary) => void>()
let requested = 0
let active = true
let running: Promise<number> | null = null

export function onMessageSummary(listener: (summary: MessageSummary) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setMessageSummaryActive(value: boolean): void { active = value; requested++ }

/** A newer invalidation prevents old reads from restoring a cleared badge. */
export function refreshMessageBadge(): Promise<number> {
  requested++
  if (running) return running
  running = refresh().finally(() => { running = null })
  return running
}

async function refresh(): Promise<number> {
  let total = 0
  while (active) {
    const ticket = requested, revision = session.getRevision()
    if (session.getState() !== 'verified') { wx.removeTabBarBadge({ index: 1 }); return 0 }
    await Promise.all([flushReadAcknowledgements().catch(() => {}), flushNotificationReads().catch(() => {}), flushDraftCleanup().catch(() => {})])
    if (!active) return total
    if (revision !== session.getRevision()) continue
    const [conversations, notifications] = await Promise.all([getUnreadMessageCount(), getUnreadCount()])
    if (!active) return total
    if (ticket !== requested || revision !== session.getRevision()) continue
    total = conversations + notifications
    if (total) wx.setTabBarBadge({ index: 1, text: total > 99 ? '99+' : String(total) })
    else wx.removeTabBarBadge({ index: 1 })
    for (const listener of listeners) listener({ conversations, notifications, total })
    return total
  }
  return total
}
