const CURSOR_VERSION = 1 as const

export interface CommentChangeCursor {
  version: typeof CURSOR_VERSION
  postId: string
  sequence: number
}

export function createCommentChangeCursor(postId: string, sequence = 0): CommentChangeCursor {
  if (!postId) throw new Error('postId is required')
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('sequence must be a non-negative integer')
  return { version: CURSOR_VERSION, postId, sequence }
}

export function advanceCommentChangeCursor(cursor: CommentChangeCursor, sequence: number): CommentChangeCursor {
  if (!Number.isSafeInteger(sequence) || sequence < cursor.sequence) {
    throw new Error('sequence cannot move a cursor backwards')
  }
  return { ...cursor, sequence }
}

export function assertCommentChangeCursorScope(cursor: CommentChangeCursor, postId: string): void {
  if (cursor.version !== CURSOR_VERSION || cursor.postId !== postId) {
    throw new Error('cursor does not belong to this post')
  }
}
