import {
  parseConversationDirectoryRequest,
  parseConversationDirectoryPage,
  type ConversationDirectoryCursor,
  type ConversationDirectoryPage,
} from '@lucky/contracts'

export interface ConversationDirectoryStore {
  list(ownerId: string, cursor: ConversationDirectoryCursor | undefined, take: number): Promise<unknown[]>
  profiles(openids: string[]): Promise<unknown[]>
}

export class InvalidDirectoryRequest extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid directory record')
  return value as Record<string, unknown>
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new Error('Invalid directory identifier')
  return value
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== 'string') throw new Error('Invalid directory timestamp')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid directory timestamp')
  return date.toISOString()
}

function decodeEntry(value: unknown, ownerId: string) {
  const entry = record(value)
  if (entry.owner_openid !== ownerId) throw new Error('Directory owner mismatch')
  const id = identifier(entry._id)
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid directory key')
  const peerId = identifier(entry.peer_openid)
  const last = record(entry.last_message)
  let target: Record<string, unknown> | undefined
  if (entry.anonymous_context !== undefined && entry.anonymous_context !== null) {
    const context = record(entry.anonymous_context)
    if (!((context.initiator_openid === ownerId && context.target_openid === peerId)
      || (context.target_openid === ownerId && context.initiator_openid === peerId))) {
      throw new Error('Invalid anonymous directory participants')
    }
    target = { anonymous: true, type: context.source_type, id: context.source_id, thread_id: context.thread_id }
  } else if (last.anonymous_context !== undefined && last.anonymous_context !== null) {
    throw new Error('Anonymous directory context is missing')
  }
  return {
    id, peerId, updatedAt: timestamp(entry.updated_at), target,
    lastMessage: { _id: last._id, content: last.content, created_at: timestamp(last.created_at) },
    unreadCount: entry.unread_count,
  }
}

/** The adapter owns query syntax; the application owns scope, bounds and public projection. */
export async function listConversationDirectory(
  store: ConversationDirectoryStore,
  principal: { ownerId: string; scope: string },
  input: unknown,
): Promise<ConversationDirectoryPage> {
  let request
  try {
    request = parseConversationDirectoryRequest(input)
    if (request.cursor && request.cursor.scope !== principal.scope) throw new Error('Wrong cursor scope')
  } catch (_) {
    throw new InvalidDirectoryRequest('Invalid directory request')
  }
  const rows = await store.list(principal.ownerId, request.cursor, request.limit + 1)
  if (rows.length > request.limit + 1) throw new Error('Unbounded directory response')
  const entries = rows.slice(0, request.limit).map(row => decodeEntry(row, principal.ownerId))
  const peerIds = [...new Set(entries.filter(entry => !entry.target).map(entry => entry.peerId))]
  const profiles = new Map<string, Record<string, unknown>>()
  if (peerIds.length) {
    for (const value of await store.profiles(peerIds)) {
      const profile = record(value)
      const id = identifier(profile._openid)
      if (!peerIds.includes(id)) throw new Error('Unexpected directory profile')
      profiles.set(id, profile)
    }
  }
  const conversations = entries.map(entry => ({
    peer: entry.target ? { nickname: '匿名用户', avatar_url: '/assets/anonymous.png' }
      : profiles.get(entry.peerId) || { _openid: entry.peerId, nickname: '用户', avatar_url: '' },
    lastMessage: entry.lastMessage,
    unreadCount: entry.unreadCount,
    chat_target: entry.target,
  }))
  const hasMore = rows.length > request.limit
  const last = entries[entries.length - 1]
  return parseConversationDirectoryPage({ conversations, hasMore,
    nextCursor: hasMore && last
      ? { version: 1, scope: principal.scope, id: last.id, updatedAt: last.updatedAt } : null,
  })
}
