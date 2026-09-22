import { parseConversationTarget } from '@lynku/contracts'

export interface AnonymousConversationContext {
  source_type: 'post' | 'comment'
  source_id: string
  target_openid: string
  initiator_openid: string
  thread_id: string
}

export interface TargetStore {
  source(type: 'post' | 'comment', id: string): Promise<unknown | null>
  directory(owner: string, conversationId: string): Promise<unknown | null>
  identifier(...parts: string[]): string
}

export class InvalidConversationTarget extends Error {}
export class ConversationTargetNotFound extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored conversation')
  return value as Record<string, unknown>
}

/** An established thread is authorized by its owner-scoped directory, independent of source visibility. */
export async function resolveConversationTarget(store: TargetStore, owner: string, input: unknown): Promise<{
  peer: string; anonymousContext: AnonymousConversationContext | null
}> {
  let request
  try { request = parseConversationTarget(input) } catch (_) { throw new InvalidConversationTarget('Invalid conversation target') }
  if ('peer' in request) {
    if (request.peer === owner) throw new InvalidConversationTarget('Cannot message yourself')
    return { peer: request.peer, anonymousContext: null }
  }
  const target = request.target
  if (target.thread_id) {
    const conversationId = store.identifier('conversation', 'anonymous', target.thread_id)
    const value = await store.directory(owner, conversationId)
    if (value !== null) {
      const entry = record(value)
      const context = record(entry.anonymous_context)
      if (entry.owner_openid !== owner || entry.conversation_id !== conversationId
        || context.thread_id !== target.thread_id || context.source_type !== target.type || context.source_id !== target.id
        || typeof context.initiator_openid !== 'string' || !context.initiator_openid
        || typeof context.target_openid !== 'string' || !context.target_openid
        || context.initiator_openid === context.target_openid) throw new ConversationTargetNotFound('Conversation not found')
      const peer = owner === context.initiator_openid ? context.target_openid
        : owner === context.target_openid ? context.initiator_openid : null
      if (!peer || entry.peer_openid !== peer
        || store.identifier('anonymous_chat', target.type, target.id, context.initiator_openid, context.target_openid) !== target.thread_id) {
        throw new ConversationTargetNotFound('Conversation not found')
      }
      return { peer, anonymousContext: { source_type: target.type, source_id: target.id,
        target_openid: context.target_openid, initiator_openid: context.initiator_openid, thread_id: target.thread_id } }
    }
  }
  const value = await store.source(target.type, target.id)
  if (value === null) throw new ConversationTargetNotFound('Source not found')
  const source = record(value)
  if (source._id !== target.id || source.status !== 'published' || source.anonymous !== true
    || typeof source._openid !== 'string' || !source._openid || source._openid === owner) {
    throw new ConversationTargetNotFound('Source not found')
  }
  if (target.type === 'comment') {
    if (typeof source.post_id !== 'string' || !source.post_id) throw new ConversationTargetNotFound('Source not found')
    const parentValue = await store.source('post', source.post_id)
    if (parentValue === null) throw new ConversationTargetNotFound('Source not found')
    const parent = record(parentValue)
    if (parent._id !== source.post_id || parent.status !== 'published') throw new ConversationTargetNotFound('Source not found')
  }
  const threadId = store.identifier('anonymous_chat', target.type, target.id, owner, source._openid)
  if (target.thread_id && target.thread_id !== threadId) throw new ConversationTargetNotFound('Conversation not found')
  return { peer: source._openid, anonymousContext: { source_type: target.type, source_id: target.id,
    target_openid: source._openid, initiator_openid: owner, thread_id: threadId } }
}
