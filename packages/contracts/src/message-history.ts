import type { MessageSyncCursor } from './messages'
import { parseAnonymousChatTarget, type AnonymousChatTarget } from './conversation-target'

export interface PublicMessage {
  _id: string
  msg_id: string
  from: string
  to: string
  content: string
  status: 'sent' | 'delivered' | 'read'
  created_at: string
  conversation_id: string
  sync_sequence: number
}

export interface MessageHistoryPage {
  messages: PublicMessage[]
  hasMore: boolean
  nextBefore: MessageSyncCursor | null
  sync_cursor: MessageSyncCursor
  chat_target?: AnonymousChatTarget
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
  return value as Record<string, unknown>
}

function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error('Invalid text')
  return value
}

export function parseMessageCursor(value: unknown): MessageSyncCursor {
  const input = object(value)
  if (input.version !== 2 || typeof input.sequence !== 'number' || !Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new Error('Invalid message cursor')
  }
  return { version: 2, conversation_id: text(input.conversation_id), sequence: input.sequence }
}

export function parseMessageHistoryRequest(value: unknown): { limit: number; before?: MessageSyncCursor } {
  const input = object(value)
  const limit = input.limit === undefined ? 30 : input.limit
  if (input.after !== undefined || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Invalid history request')
  }
  return input.before === undefined ? { limit } : { limit, before: parseMessageCursor(input.before) }
}

export function parsePublicMessage(value: unknown): PublicMessage {
  const input = object(value)
  const sequence = input.sync_sequence
  const status = input.status
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1
    || (status !== 'sent' && status !== 'delivered' && status !== 'read')) throw new Error('Invalid message state')
  const createdAt = text(input.created_at, 30)
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== createdAt) throw new Error('Invalid message date')
  return {
    _id: text(input._id), msg_id: text(input.msg_id), from: text(input.from), to: text(input.to),
    content: text(input.content, 5000), status, created_at: createdAt,
    conversation_id: text(input.conversation_id), sync_sequence: sequence,
  }
}

export function parseMessageHistoryPage(value: unknown): MessageHistoryPage {
  const input = object(value)
  if (!Array.isArray(input.messages) || input.messages.length > 50 || typeof input.hasMore !== 'boolean') {
    throw new Error('Invalid history page')
  }
  const messages = input.messages.map(parsePublicMessage)
  const sync = parseMessageCursor(input.sync_cursor)
  const before = input.nextBefore === null ? null : parseMessageCursor(input.nextBefore)
  let previous = 0
  for (const message of messages) {
    if (message.conversation_id !== sync.conversation_id || message.sync_sequence <= previous) throw new Error('Invalid history order')
    previous = message.sync_sequence
  }
  if (sync.sequence !== previous || input.hasMore !== (before !== null)
    || (before && (before.conversation_id !== sync.conversation_id || before.sequence !== messages[0]?.sync_sequence))) {
    throw new Error('Invalid history boundary')
  }
  const result: MessageHistoryPage = { messages, hasMore: input.hasMore, nextBefore: before, sync_cursor: sync }
  if (input.chat_target !== undefined) result.chat_target = parseAnonymousChatTarget(input.chat_target)
  return result
}
