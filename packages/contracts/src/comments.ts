export interface CommentChangeCursor {
  version: 1
  post_id: string
  sequence: number
}

export interface SyncCommentChangesRequest {
  cursor: CommentChangeCursor
  limit?: number
}

export interface CommentChange {
  comment_id: string
  sequence: number
  type: 'created' | 'deleted'
}

export interface SyncCommentChangesResponse {
  changes: CommentChange[]
  nextCursor: CommentChangeCursor
  hasMore: boolean
}
