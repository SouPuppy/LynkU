import { parseAdminCommentDetail, type AdminCommentDetail } from '@lynku/contracts'
import { projectComment } from './comment-view'
import { nextCommentSequence } from './write-comment'
export class CommentGovernanceFailure extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT') { super(code) }
}
interface CommentPreviewStore { read(id: string): Promise<unknown | null>; post(id: string): Promise<unknown | null>; identifier(...parts: string[]): string }
export async function readGovernanceComment(store: CommentPreviewStore, id: unknown): Promise<AdminCommentDetail> {
  if (typeof id !== 'string' || !id || id.length > 128) throw new CommentGovernanceFailure('INVALID_INPUT')
  const value = await store.read(id)
  if (value === null) throw new CommentGovernanceFailure('NOT_FOUND')
  const comment = projectComment(value, '')
  if (comment._id !== id) throw Error('Comment identity mismatch')
  if (comment.status !== 'published') throw new CommentGovernanceFailure('CONFLICT')
  const parent = await store.post(comment.post_id)
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) throw new CommentGovernanceFailure('NOT_FOUND')
  const parentRow = parent as Record<string, unknown>
  if (parentRow._id !== comment.post_id) throw Error('Comment parent mismatch')
  if (parentRow.status !== 'published' && parentRow.status !== 'hidden' && parentRow.status !== 'flagged') throw new CommentGovernanceFailure('NOT_FOUND')
  const versionToken = store.identifier('comment-governance:1', id, comment.post_id, comment.parent_id || '', comment.content, String(comment.anonymous), comment.created_at)
  return parseAdminCommentDetail({ _id: id, post_id: comment.post_id, parent_id: comment.parent_id, depth: comment.depth, content: comment.content,
    anonymous: comment.anonymous, authorLabel: comment.author.nickname, status: comment.status, created_at: comment.created_at, versionToken })
}
export interface GovernedCommentTransaction extends CommentPreviewStore {
  counter(postId: string): Promise<unknown | null>
  decrementPost(postId: string): Promise<void>
  remove(id: string, caseId: string, at: string): Promise<void>
  append(postId: string, commentId: string, sequence: number, at: string): Promise<void>
}
export async function removeReportedComment(tx: GovernedCommentTransaction, id: string, expectedToken: string, caseId: string, at: string) {
  const comment = await readGovernanceComment(tx, id)
  if (comment.versionToken !== expectedToken) throw new CommentGovernanceFailure('CONFLICT')
  const counter = await tx.counter(comment.post_id)
  if (counter !== null && (typeof counter !== 'object' || Array.isArray(counter) || (counter as Record<string, unknown>).post_id !== comment.post_id)) throw Error('Comment counter scope mismatch')
  const sequence = nextCommentSequence(counter)
  await tx.decrementPost(comment.post_id)
  await tx.remove(id, caseId, at)
  await tx.append(comment.post_id, id, sequence, at)
}
