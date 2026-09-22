import { parseReadMessageIds, parseReadReceipts } from '@lynku/contracts'
import { projectMessage, type AuthorizedConversation } from './message-view'

export interface ReadReceiptStore {
  list(conversationId: string, sender: string, ids: string[]): Promise<unknown[]>
}

export class InvalidReceiptRequest extends Error {}

export async function readReceipts(store: ReadReceiptStore, conversation: AuthorizedConversation, input: unknown): Promise<string[]> {
  let ids: string[]
  try { ids = parseReadMessageIds(input) } catch (_) { throw new InvalidReceiptRequest('Invalid receipt request') }
  const rows = await store.list(conversation.id, conversation.viewer, ids)
  if (rows.length > ids.length) throw new Error('Unbounded receipt response')
  const readIds = rows.map(row => {
    const message = projectMessage(row, conversation)
    if (message.from !== conversation.viewer || message.status !== 'read') throw new Error('Invalid receipt owner or state')
    return message._id
  })
  return parseReadReceipts({ readIds }, ids)
}
