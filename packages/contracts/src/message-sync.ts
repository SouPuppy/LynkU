import { parseMessageCursor, parsePublicMessage, type PublicMessage } from './message-history'
import type { MessageSyncCursor } from './messages'

export interface MessageSyncPage {
  messages: PublicMessage[]
  hasMore: boolean
  nextCursor: MessageSyncCursor
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
  return value as Record<string, unknown>
}

export function parseMessageSyncRequest(value: unknown): { limit: number; cursor: MessageSyncCursor } {
  const input = object(value)
  const limit = input.limit === undefined ? 50 : input.limit
  if (input.since !== undefined || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Invalid sync request')
  }
  return { limit, cursor: parseMessageCursor(input.cursor) }
}

export function parseMessageSyncPage(value: unknown, after: MessageSyncCursor): MessageSyncPage {
  const input = object(value)
  if (!Array.isArray(input.messages) || input.messages.length > 50 || typeof input.hasMore !== 'boolean') {
    throw new Error('Invalid sync page')
  }
  const messages = input.messages.map(parsePublicMessage)
  let sequence = after.sequence
  for (const message of messages) {
    if (message.conversation_id !== after.conversation_id || message.sync_sequence <= sequence) {
      throw new Error('Invalid sync order or scope')
    }
    sequence = message.sync_sequence
  }
  const nextCursor = parseMessageCursor(input.nextCursor)
  if (nextCursor.conversation_id !== after.conversation_id || nextCursor.sequence !== sequence
    || (input.hasMore && messages.length === 0)) throw new Error('Invalid sync boundary')
  return { messages, hasMore: input.hasMore, nextCursor }
}
