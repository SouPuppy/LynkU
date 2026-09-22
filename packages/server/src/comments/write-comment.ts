import { parseCreateCommentRequest, type CommentView } from '@lynku/contracts'
import { projectComment } from './comment-view'
import { assertAccountCapability } from '../shared'
import { ModerationFailure } from '../shared'

type Row = Record<string, unknown>
export class CommentWriteFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'CONFLICT' | 'POST_NOT_FOUND' | 'NOT_FOUND' | 'MAX_DEPTH' | 'PARENT_MISMATCH' | 'FORBIDDEN' | 'EMAIL_NOT_VERIFIED') { super(code) }
}

export interface CommentWriteTransaction {
  audit(event: { actor: string; target: string; before: string; at: string }): Promise<void>
  comment(id: string): Promise<unknown | null>
  post(id: string): Promise<unknown | null>
  account(id: string): Promise<unknown | null>
  create(id: string, data: Row): Promise<void>
  remove(id: string, timestamp: string): Promise<void>
  adjustPostCount(id: string, delta: number): Promise<void>
  appendChange(postId: string, commentId: string, type: 'created' | 'deleted'): Promise<void>
  enqueue(comment: Row, post: Row, parent: Row | null): Promise<string[]>
}
export interface CommentWriteStore {
  existing(id: string): Promise<unknown | null>
  run<T>(operation: (transaction: CommentWriteTransaction) => Promise<T>): Promise<T>
  identifier(...parts: string[]): string
  now(): string
  allowCreate(): Promise<void>
  moderate(content: string): Promise<{ clean: boolean }>
}
export interface CommentReceipt { comment: CommentView; flagged: boolean; status: 'created' | 'duplicate'; outboxIds: string[] }

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored comment resource')
  return value as Row
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid stored comment identity')
  return value
}
function publishedPost(value: unknown): Row {
  if (value === null) throw new CommentWriteFailure('POST_NOT_FOUND')
  const result = row(value)
  if (result.status !== 'published') throw new CommentWriteFailure('POST_NOT_FOUND')
  text(result._id); text(result._openid); text(result.title)
  return result
}

/** Authorization is repeated inside the transaction; a profile edited during creation cannot produce an old snapshot. */
export async function createUserComment(store: CommentWriteStore, owner: string, accountId: string, value: unknown): Promise<CommentReceipt> {
  let input
  try { input = parseCreateCommentRequest(value) } catch (_) { throw new CommentWriteFailure('INVALID_INPUT') }
  const id = store.identifier('comment:create', owner, input.request_id)
  const fingerprint = store.identifier('comment:payload', input.post_id, input.parent_id || '', input.content, String(input.anonymous))
  const receipt = (value: unknown, status: 'created' | 'duplicate', outboxIds: string[] = []): CommentReceipt => {
    const saved = row(value)
    if (saved._id !== id || saved._openid !== owner || saved.request_fingerprint !== fingerprint) throw new CommentWriteFailure('CONFLICT')
    return { comment: projectComment(saved, owner), flagged: saved.status === 'flagged', status, outboxIds }
  }
  const existing = await store.existing(id)
  if (existing !== null) return receipt(existing, 'duplicate')
  await store.allowCreate()
  const verdict = await store.moderate(input.content)
  if (verdict?.clean !== true) throw new ModerationFailure(verdict?.clean === false ? 'CONTENT_REJECTED' : 'MODERATION_UNAVAILABLE')
  const timestamp = store.now()
  if (new Date(timestamp).toISOString() !== timestamp) throw new Error('Invalid comment clock')
  return store.run(async transaction => {
    const account = row(await transaction.account(accountId))
    if (account._openid !== owner) throw new CommentWriteFailure('FORBIDDEN')
    if (account.verified !== true) throw new CommentWriteFailure('EMAIL_NOT_VERIFIED')
    assertAccountCapability(account, 'comments', store.now())
    const duplicate = await transaction.comment(id)
    if (duplicate !== null) return receipt(duplicate, 'duplicate')
    const post = publishedPost(await transaction.post(input.post_id))
    let parent: Row | null = null
    if (input.parent_id) {
      const found = await transaction.comment(input.parent_id)
      if (found === null) throw new CommentWriteFailure('NOT_FOUND')
      parent = row(found)
      if (parent.status !== 'published') throw new CommentWriteFailure('NOT_FOUND')
      if (parent.post_id !== input.post_id) throw new CommentWriteFailure('PARENT_MISMATCH')
      if (parent.depth !== 0) throw new CommentWriteFailure('MAX_DEPTH')
    }
    const version = account.profile_version
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid author version')
    const author = input.anonymous ? { _openid: owner } : { _openid: owner,
      nickname: text(account.nickname), avatar_url: typeof account.avatar_url === 'string' ? account.avatar_url : '', profile_version: version }
    const comment: Row = { _id: id, _openid: owner, post_id: input.post_id, parent_id: input.parent_id,
      depth: input.parent_id ? 1 : 0, content: input.content, anonymous: input.anonymous, author,
      status: 'published', created_at: timestamp,
      request_id: input.request_id, request_fingerprint: fingerprint }
    await transaction.create(id, comment)
    await transaction.adjustPostCount(input.post_id, 1)
    await transaction.appendChange(input.post_id, id, 'created')
    const outboxIds = await transaction.enqueue(comment, post, parent)
    return receipt(comment, 'created', outboxIds)
  })
}

export async function deleteUserComment(store: Pick<CommentWriteStore, 'run' | 'now'>, owner: string,
  administrator: boolean, id: unknown): Promise<{ deleted: true }> {
  if (typeof id !== 'string' || !id || id.length > 128) throw new CommentWriteFailure('INVALID_INPUT')
  return store.run(async transaction => {
    const found = await transaction.comment(id)
    if (found === null) throw new CommentWriteFailure('NOT_FOUND')
    const current = row(found)
    if (current._openid !== owner && !administrator) throw new CommentWriteFailure('FORBIDDEN')
    if (current.status === 'deleted') return { deleted: true }
    const at = store.now()
    await transaction.remove(id, at)
    if (current.status === 'published') {
      const postId = text(current.post_id)
      await transaction.adjustPostCount(postId, -1)
      await transaction.appendChange(postId, id, 'deleted')
    }
    if (administrator && current._openid !== owner) await transaction.audit({ actor: owner, target: id, before: text(current.status), at })
    return { deleted: true }
  })
}

export function nextCommentSequence(value: unknown): number {
  if (value === null) return 1
  const current = row(value).sequence
  if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid comment sequence')
  }
  return current + 1
}
