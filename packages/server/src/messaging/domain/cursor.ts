const CURSOR_VERSION = 2 as const

export interface MessageCursor {
  version: typeof CURSOR_VERSION
  conversationId: string
  sequence: number
}

export function createMessageCursor(conversationId: string, sequence = 0): MessageCursor {
  if (!conversationId) throw new Error('conversationId is required')
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('sequence must be a non-negative integer')
  return { version: CURSOR_VERSION, conversationId, sequence }
}

export function advanceMessageCursor(cursor: MessageCursor, appliedSequence: number): MessageCursor {
  if (!Number.isSafeInteger(appliedSequence) || appliedSequence < cursor.sequence) {
    throw new Error('appliedSequence cannot move a cursor backwards')
  }
  return { ...cursor, sequence: appliedSequence }
}

export function assertMessageCursorScope(cursor: MessageCursor, conversationId: string): void {
  if (cursor.version !== CURSOR_VERSION || cursor.conversationId !== conversationId) {
    throw new Error('cursor does not belong to this conversation')
  }
}
