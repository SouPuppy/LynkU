export interface ConversationDirectoryCursor {
  version: 1
  scope: string
  id: string
  updatedAt: string
}

export interface ConversationSummary {
  peer: { _openid?: string; nickname: string; avatar_url: string }
  lastMessage: { _id: string; content: string; created_at: string }
  unreadCount: number
  chat_target?: { anonymous: true; thread_id: string }
}

export interface ConversationDirectoryPage {
  conversations: ConversationSummary[]
  hasMore: boolean
  nextCursor: ConversationDirectoryCursor | null
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max) {
    throw new Error('Invalid text')
  }
  return value
}

function timestamp(value: unknown): string {
  const result = text(value, 30)
  const date = new Date(result)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) throw new Error('Invalid timestamp')
  return result
}

function digest(value: unknown): string {
  const result = text(value, 64)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('Invalid digest')
  return result
}

export function parseConversationDirectoryCursor(value: unknown): ConversationDirectoryCursor {
  const input = record(value)
  if (input.version !== 1) throw new Error('Invalid cursor version')
  return { version: 1, scope: digest(input.scope), id: digest(input.id), updatedAt: timestamp(input.updatedAt) }
}

export function parseConversationDirectoryRequest(value: unknown): {
  limit: number; cursor?: ConversationDirectoryCursor
} {
  const input = record(value)
  const limit = input.limit === undefined ? 20 : input.limit
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Invalid page limit')
  }
  return input.cursor === undefined ? { limit } : { limit, cursor: parseConversationDirectoryCursor(input.cursor) }
}

export function parseConversationSummary(value: unknown): ConversationSummary {
  const input = record(value)
  const peer = record(input.peer)
  const message = record(input.lastMessage)
  if (typeof input.unreadCount !== 'number' || !Number.isSafeInteger(input.unreadCount) || input.unreadCount < 0) {
    throw new Error('Invalid unread count')
  }
  const result: ConversationSummary = {
    peer: { nickname: text(peer.nickname, 100), avatar_url: text(peer.avatar_url, 2048, true) },
    lastMessage: { _id: text(message._id, 128), content: text(message.content, 5000), created_at: timestamp(message.created_at) },
    unreadCount: input.unreadCount,
  }
  if (input.chat_target !== undefined) {
    const target = record(input.chat_target)
    if (target.anonymous !== true || Object.keys(target).some(key => key !== 'anonymous' && key !== 'thread_id')) {
      throw new Error('Invalid anonymous target')
    }
    result.chat_target = { anonymous: true, thread_id: digest(target.thread_id) }
    if (peer._openid !== undefined) result.peer._openid = text(peer._openid, 128)
  } else {
    result.peer._openid = text(peer._openid, 128)
  }
  return result
}

export function parseConversationDirectoryPage(value: unknown): ConversationDirectoryPage {
  const input = record(value)
  if (!Array.isArray(input.conversations) || input.conversations.length > 50 || typeof input.hasMore !== 'boolean') {
    throw new Error('Invalid directory page')
  }
  const nextCursor = input.nextCursor === null ? null : parseConversationDirectoryCursor(input.nextCursor)
  if (input.hasMore !== (nextCursor !== null) || (input.hasMore && input.conversations.length === 0)) {
    throw new Error('Inconsistent directory cursor')
  }
  return { conversations: input.conversations.map(parseConversationSummary), hasMore: input.hasMore, nextCursor }
}
