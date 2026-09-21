import { parseReadMessageIds } from '@lucky/contracts'
import { projectMessage, type AuthorizedConversation } from './message-view'

export interface ReadTransaction {
  message(id: string): Promise<unknown>
  directory(): Promise<unknown>
  setMessageRead(id: string): Promise<void>
  setDirectoryUnread(count: number, lastMessageRead: boolean): Promise<void>
}

export interface ReadTransactionStore {
  run<T>(operation: (transaction: ReadTransaction) => Promise<T>): Promise<T>
}

export class InvalidReadRequest extends Error {}

/** All facts and their unread projection commit together, including on retries. */
export async function markMessagesRead(store: ReadTransactionStore, conversation: AuthorizedConversation, input: unknown): Promise<number> {
  let ids: string[]
  try { ids = parseReadMessageIds(input) } catch (_) { throw new InvalidReadRequest('Invalid read request') }
  return store.run(async transaction => {
    const changed: string[] = []
    for (const id of ids) {
      const message = projectMessage(await transaction.message(id), conversation)
      if (message._id !== id || message.to !== conversation.viewer) throw new InvalidReadRequest('Only received messages may be read')
      if (message.status !== 'read') changed.push(id)
    }
    if (!changed.length) return 0
    const value = await transaction.directory()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing conversation directory')
    const entry = value as Record<string, unknown>
    if (entry.owner_openid !== conversation.viewer || entry.conversation_id !== conversation.id
      || typeof entry.unread_count !== 'number' || !Number.isSafeInteger(entry.unread_count)
      || entry.unread_count < changed.length) throw new Error('Inconsistent conversation unread count')
    const last = entry.last_message
    const lastMessageRead = !!last && typeof last === 'object' && '_id' in last
      && typeof last._id === 'string' && changed.includes(last._id)
    // Complete reads before writes so adapters can enforce transactional read ordering.
    for (const id of changed) await transaction.setMessageRead(id)
    await transaction.setDirectoryUnread(entry.unread_count - changed.length, lastMessageRead)
    return changed.length
  })
}
