import { projectMessage, type AuthorizedConversation } from './message-view'
import { parseMessageHistoryRequest, parseMessageHistoryPage, type MessageHistoryPage } from '@lynku/contracts'

export interface MessageHistoryStore {
  list(conversationId: string, before: number | undefined, take: number): Promise<unknown[]>
  firstUnread?(conversationId: string, viewer: string): Promise<unknown | null>
}

export class InvalidHistoryRequest extends Error {}

export async function readMessageHistory(
  store: MessageHistoryStore,
  conversation: AuthorizedConversation,
  input: unknown,
): Promise<MessageHistoryPage> {
  let request
  try {
    request = parseMessageHistoryRequest(input)
    if (request.before && request.before.conversation_id !== conversation.id) throw new Error('Wrong conversation')
  } catch (_) { throw new InvalidHistoryRequest('Invalid history request') }
  const firstUnread = !request.before && store.firstUnread ? await store.firstUnread(conversation.id, conversation.viewer) : null
  const unread = firstUnread === null ? null : projectMessage(firstUnread, conversation)
  if (unread && (unread.to !== conversation.viewer || unread.status === 'read')) throw Error('Invalid unread anchor')
  const beforeSequence = request.before?.sequence ?? (unread ? unread.sync_sequence + request.limit : undefined)
  const rows = await store.list(conversation.id, beforeSequence, request.limit + 1)
  if (rows.length > request.limit + 1) throw new Error('Unbounded history response')
  const hasMore = rows.length > request.limit
  const messages = rows.slice(0, request.limit).reverse().map(value => {
    const message = projectMessage(value, conversation)
    if (request.before && message.sync_sequence >= request.before.sequence) throw new Error('Message exceeds history boundary')
    return message
  })
  return parseMessageHistoryPage({ messages, hasMore,
    ...(unread ? { first_unread_id: unread._id } : {}),
    nextBefore: hasMore ? { version: 2, conversation_id: conversation.id, sequence: messages[0]?.sync_sequence } : null,
    sync_cursor: { version: 2, conversation_id: conversation.id, sequence: messages[messages.length - 1]?.sync_sequence || 0 },
  })
}
