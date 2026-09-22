// services/comments.ts — Comment data access
// All reads and writes go through cloud functions so anonymous ownership stays private.

import type { IComment, ICommentChange, ICommentChangeCursor, ICommentWithReplies } from '../typings/cloudbase'
import { callCloud, CloudCallError } from './cloud'
import { parseCommentHistoryPage, parseCommentView, parseCommentSyncPage, type CommentHistoryCursor, type CommentHistoryPage } from '../generated/contracts/index'

export async function listCommentsByPost(
  postId: string,
  cursor: CommentHistoryCursor | null = null,
  limit = 50,
): Promise<CommentHistoryPage> {
  const result = await callCloud<unknown>('comments', {
    action: 'list',
    post_id: postId,
    cursor,
    limit,
  })
  try { return parseCommentHistoryPage(result, postId) } catch (_) {
    throw new CloudCallError('评论返回了无效数据', 'INVALID_RESPONSE', 'comments', 'list')
  }
}

/** Create comment via cloud function */
export async function createComment(data: {
  postId: string
  content: string
  parentId?: string
  anonymous: boolean
  requestId: string
}): Promise<{ comment: IComment; flagged: boolean; status?: 'created' | 'duplicate' }> {
  const response = await callCloud<unknown>('comments', {
    action: 'create',
    post_id: data.postId,
    content: data.content,
    parent_id: data.parentId || undefined,
    anonymous: !!data.anonymous,
    request_id: data.requestId,
  })
  try {
    if (!response || typeof response !== 'object' || !('comment' in response) || !('flagged' in response)
      || typeof response.flagged !== 'boolean') throw new Error('Invalid response')
    const comment = parseCommentView(response.comment)
    if (comment.post_id !== data.postId) throw new Error('Invalid scope')
    return { comment, flagged: response.flagged }
  } catch (_) { throw new CloudCallError('评论返回了无效数据', 'INVALID_RESPONSE', 'comments', 'create') }
}

/** Delete comment via cloud function */
export async function deleteComment(commentId: string): Promise<void> {
  await callCloud('comments', { action: 'delete', comment_id: commentId })
}

export async function syncCommentChanges(
  postId: string,
  cursor: ICommentChangeCursor,
  limit = 50,
): Promise<{ changes: ICommentChange[]; nextCursor: ICommentChangeCursor; hasMore: boolean }> {
  const result = await callCloud<unknown>('comments', {
    action: 'syncChanges',
    post_id: postId,
    cursor,
    limit,
  })
  if (cursor.post_id !== postId) throw new CloudCallError('评论同步范围无效', 'INVALID_RESPONSE', 'comments', 'syncChanges')
  try { return parseCommentSyncPage(result, cursor) } catch (_) {
    throw new CloudCallError('评论同步返回了无效数据', 'INVALID_RESPONSE', 'comments', 'syncChanges')
  }
}

/** Build a 2-level comment tree from flat array */
export function buildCommentTree(comments: IComment[]): ICommentWithReplies[] {
  const topLevel: ICommentWithReplies[] = []
  const children: Record<string, IComment[]> = {}

  for (const c of comments) {
    if (c.parent_id) {
      if (!children[c.parent_id]) children[c.parent_id] = []
      children[c.parent_id].push(c)
    } else {
      topLevel.push({ ...c, replies: [] })
    }
  }

  for (const c of topLevel) {
    c.replies = children[c._id] || []
  }

  return topLevel
}
