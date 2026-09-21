import type { CommentChangeCursor as ContractCursor } from '@lucky/contracts'
import { assertCommentChangeCursorScope, createCommentChangeCursor, type CommentChangeCursor } from '../domain/cursor'

export function decodeCommentSyncCursor(cursor: ContractCursor, postId: string): CommentChangeCursor {
  const domain = createCommentChangeCursor(cursor.post_id, cursor.sequence)
  assertCommentChangeCursorScope(domain, postId)
  return domain
}
