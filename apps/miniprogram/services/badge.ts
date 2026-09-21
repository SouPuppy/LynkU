import * as session from './session'
import { getUnreadMessageCount } from './messages'
import { getUnreadCount } from './notifications'
import { flushReadAcknowledgements } from './read-queue'

import { flushDraftCleanup } from './draft-cleanup'

const MESSAGE_TAB_INDEX = 1

export async function refreshMessageBadge(): Promise<number> {
  const openid = session.getOpenid()
  if (session.getState() !== 'verified') {
    wx.removeTabBarBadge({ index: MESSAGE_TAB_INDEX })
    return 0
  }
  await flushReadAcknowledgements().catch(() => {})
  await flushDraftCleanup().catch(() => {})
  if (session.getOpenid() !== openid || session.getState() !== 'verified') return 0
  const [conversationUnread, notificationUnread] = await Promise.all([
    getUnreadMessageCount(),
    getUnreadCount(),
  ])
  if (session.getOpenid() !== openid || session.getState() !== 'verified') return 0
  const total = conversationUnread + notificationUnread

  if (total > 0) {
    wx.setTabBarBadge({
      index: MESSAGE_TAB_INDEX,
      text: total > 99 ? '99+' : String(total),
    })
  } else {
    wx.removeTabBarBadge({ index: MESSAGE_TAB_INDEX })
  }

  return total
}
