import { ANONYMOUS_AVATAR } from '@lynku/contracts'
import { parseConversationDisplay, type ConversationDisplay } from '@lynku/contracts'
import type { AnonymousConversationContext } from './resolve-target'

export function projectConversationDisplay(viewer: string, context: AnonymousConversationContext | null,
  profile: unknown, blockedHere: boolean): ConversationDisplay {
  if (context && viewer !== context.initiator_openid && viewer !== context.target_openid) throw Error('Invalid conversation viewer')
  const initiator = context?.initiator_openid === viewer
  const selfVisibility = context ? initiator ? context.initiator_visibility : context.target_visibility : 'real'
  const peerVisibility = context ? initiator ? context.target_visibility : context.initiator_visibility : 'real'
  const named = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile as Record<string, unknown> : null
  return parseConversationDisplay({ selfVisibility, peerVisibility, blockedHere,
    peerName: peerVisibility === 'anonymous' ? `匿名会话 · ${context!.thread_id.slice(0, 6).toUpperCase()}` : named?.nickname || '用户',
    peerAvatar: peerVisibility === 'anonymous' ? ANONYMOUS_AVATAR : named?.avatar_url || '' })
}

/** Only the viewer's own action in this channel is visible; never disclose pair-wide block state. */
export function blockedInConversation(value: unknown, owner: string, conversation: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.blockedBy) || !row.blockedBy.includes(owner)) return false
  if (!row.operations || typeof row.operations !== 'object' || Array.isArray(row.operations)) return false
  const own = (row.operations as Record<string, unknown>)[owner]
  return Array.isArray(own) && own.includes(conversation)
}
