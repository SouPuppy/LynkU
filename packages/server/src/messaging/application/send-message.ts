import { parseSendMessageRequest, type SendMessageResponse } from '@lynku/contracts'
import { projectMessage, type AuthorizedConversation } from './message-view'

export interface SendTransaction {
  existing(): Promise<unknown | null>
  counter(): Promise<unknown | null>
  directory(owner: string): Promise<unknown | null>
  writeCounter(sequence: number): Promise<void>
  writeMessage(message: Record<string, unknown>): Promise<void>
  writeDirectory(owner: string, entry: Record<string, unknown>): Promise<void>
}

export interface MessageSendStore {
  existing(id: string): Promise<unknown | null>
  /** Must reject before any recipient lookup, rate write, or message transaction. */
  moderate(content: string): Promise<{ clean: boolean }>
  authorizeRecipientAndRate(): Promise<void>
  run<T>(documentId: string, operation: (transaction: SendTransaction) => Promise<T>): Promise<T>
  timestamp(): unknown
  identifier(...parts: string[]): string
}

export class InvalidSendRequest extends Error {}
export class MessageIdConflict extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored message state')
  return value as Record<string, unknown>
}

export async function sendNewMessage(
  store: MessageSendStore,
  conversation: AuthorizedConversation,
  anonymousContext: unknown,
  input: unknown,
): Promise<SendMessageResponse> {
  let request
  try { request = parseSendMessageRequest(input) } catch (_) { throw new InvalidSendRequest('Invalid send request') }
  if (conversation.viewer === conversation.peer) throw new InvalidSendRequest('Cannot message yourself')
  if (conversation.anonymousThread) {
    const context = record(anonymousContext)
    if (context.thread_id !== conversation.anonymousThread
      || !((context.initiator_openid === conversation.viewer && context.target_openid === conversation.peer)
        || (context.target_openid === conversation.viewer && context.initiator_openid === conversation.peer))) throw new InvalidSendRequest('Invalid anonymous participants')
  } else if (anonymousContext !== null) throw new InvalidSendRequest('Unexpected anonymous context')
  const id = store.identifier(conversation.viewer, request.msg_id)
  const fingerprint = store.identifier('message:payload', conversation.peer, request.content, conversation.anonymousThread || '')
  const duplicate = (value: unknown): SendMessageResponse => {
    const row = record(value)
    if (row._id !== id || row.from !== conversation.viewer || row.request_fingerprint !== fingerprint) throw new MessageIdConflict('Message ID already binds another payload')
    return { message: projectMessage(row, conversation), status: 'duplicate' }
  }
  const existing = await store.existing(id)
  if (existing !== null) return duplicate(existing)
  const moderation = await store.moderate(request.content)
  if (!moderation || moderation.clean !== true) throw new InvalidSendRequest('Message moderation unavailable')
  await store.authorizeRecipientAndRate()
  const result = await store.run(id, async transaction => {
    const found = await transaction.existing()
    if (found !== null) return duplicate(found)
    const counterValue = await transaction.counter()
    let previous = 0
    if (counterValue !== null) {
      const counter = record(counterValue)
      if (typeof counter.last_sequence !== 'number' || !Number.isSafeInteger(counter.last_sequence)
        || counter.last_sequence < 1 || counter.last_sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid conversation sequence')
      previous = counter.last_sequence
    }
    const owners = [conversation.viewer, conversation.peer]
    const entries: { owner: string; peer: string; unread: number }[] = []
    for (const owner of owners) {
      const peer = owner === conversation.viewer ? conversation.peer : conversation.viewer
      const value = await transaction.directory(owner)
      if ((value === null) !== (counterValue === null)) throw new Error('Incomplete conversation state')
      let unread = 0
      if (value !== null) {
        const entry = record(value)
        if (entry.owner_openid !== owner || entry.peer_openid !== peer || entry.conversation_id !== conversation.id
          || entry.last_sequence !== previous || typeof entry.unread_count !== 'number'
          || !Number.isSafeInteger(entry.unread_count) || entry.unread_count < 0
          || entry.unread_count >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid conversation directory')
        unread = entry.unread_count
      }
      entries.push({ owner, peer, unread: unread + (owner === conversation.peer ? 1 : 0) })
    }
    const sequence = previous + 1
    const timestamp = store.timestamp()
    const message: Record<string, unknown> = {
      _id: id, msg_id: request.msg_id, from: conversation.viewer, to: conversation.peer,
      content: request.content, status: 'sent', created_at: timestamp, updated_at: timestamp,
      conversation_id: conversation.id, sync_sequence: sequence, request_fingerprint: fingerprint,
    }
    if (anonymousContext !== null) message.anonymous_context = anonymousContext
    await transaction.writeCounter(sequence)
    await transaction.writeMessage(message)
    for (const entry of entries) await transaction.writeDirectory(entry.owner, {
      owner_openid: entry.owner, peer_openid: entry.peer, conversation_id: conversation.id,
      anonymous_context: anonymousContext, last_sequence: sequence, unread_count: entry.unread,
      updated_at: timestamp,
      last_message: { _id: id, msg_id: request.msg_id, from: conversation.viewer, to: conversation.peer,
        content: request.content, status: 'sent', created_at: timestamp, sync_sequence: sequence },
    })
    return null
  })
  if (result) return result
  // A failed confirmation is retried with the same ID; never mask a transaction error as a duplicate.
  const saved = await store.existing(id)
  if (saved === null) throw new Error('Committed message unavailable')
  return { ...duplicate(saved), status: 'sent' }
}
