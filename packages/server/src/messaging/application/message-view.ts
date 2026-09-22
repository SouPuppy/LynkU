import { parsePublicMessage, type PublicMessage } from '@lynku/contracts'

export interface AuthorizedConversation {
  id: string
  viewer: string
  peer: string
  anonymousThread?: string
}

/** Shared database boundary for historical and incremental message reads. */
export function projectMessage(value: unknown, conversation: AuthorizedConversation): PublicMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message record')
  const row = value as Record<string, unknown>
  if (row.conversation_id !== conversation.id
    || !((row.from === conversation.viewer && row.to === conversation.peer)
      || (row.to === conversation.viewer && row.from === conversation.peer))) throw new Error('Message scope mismatch')
  const context = row.anonymous_context
  if (conversation.anonymousThread) {
    if (!context || typeof context !== 'object' || !('thread_id' in context)
      || context.thread_id !== conversation.anonymousThread) throw new Error('Anonymous thread mismatch')
  } else if (context !== undefined && context !== null) throw new Error('Unexpected anonymous message')
  if (!(row.created_at instanceof Date) && typeof row.created_at !== 'string') throw new Error('Invalid message date')
  return parsePublicMessage({
    _id: row._id, msg_id: row.msg_id, content: row.content, status: row.status,
    from: conversation.anonymousThread && row.from === conversation.peer ? 'anonymous_peer' : row.from,
    to: conversation.anonymousThread && row.to === conversation.peer ? 'anonymous_peer' : row.to,
    created_at: new Date(row.created_at).toISOString(),
    conversation_id: row.conversation_id, sync_sequence: row.sync_sequence,
  })
}
