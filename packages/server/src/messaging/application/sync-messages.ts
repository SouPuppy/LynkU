import { parseMessageSyncRequest, parseMessageSyncPage, type MessageSyncPage } from '@lucky/contracts'
import { projectMessage, type AuthorizedConversation } from './message-view'

export interface MessageSyncStore {
  list(conversationId: string, after: number, take: number): Promise<unknown[]>
}

export class InvalidMessageSyncRequest extends Error {}

export async function syncMessages(store: MessageSyncStore, conversation: AuthorizedConversation, input: unknown): Promise<MessageSyncPage> {
  let request
  try {
    request = parseMessageSyncRequest(input)
    if (request.cursor.conversation_id !== conversation.id) throw new Error('Wrong conversation')
  } catch (_) { throw new InvalidMessageSyncRequest('Invalid sync request') }
  const rows = await store.list(conversation.id, request.cursor.sequence, request.limit + 1)
  if (rows.length > request.limit + 1) throw new Error('Unbounded sync response')
  const messages = rows.slice(0, request.limit).map(row => projectMessage(row, conversation))
  return parseMessageSyncPage({ messages, hasMore: rows.length > request.limit,
    nextCursor: { version: 2, conversation_id: conversation.id,
      sequence: messages[messages.length - 1]?.sync_sequence ?? request.cursor.sequence },
  }, request.cursor)
}
