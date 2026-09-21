export type ConversationKind = 'direct' | 'anonymous'

export interface MessageSyncCursor {
  version: 2
  conversation_id: string
  sequence: number
}

export interface SyncConversationRequest {
  cursor: MessageSyncCursor
  limit?: number
}
