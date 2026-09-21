import type { MessageSyncCursor as ContractCursor } from '@lucky/contracts'
import {
  advanceMessageCursor,
  assertMessageCursorScope,
  createMessageCursor,
  type MessageCursor,
} from '../domain/cursor'

export function decodeSyncCursor(cursor: ContractCursor, conversationId: string): MessageCursor {
  const domainCursor = createMessageCursor(cursor.conversation_id, cursor.sequence)
  assertMessageCursorScope(domainCursor, conversationId)
  return domainCursor
}

export function encodeSyncCursor(cursor: MessageCursor, appliedSequence: number): ContractCursor {
  const next = advanceMessageCursor(cursor, appliedSequence)
  return { version: next.version, conversation_id: next.conversationId, sequence: next.sequence }
}
