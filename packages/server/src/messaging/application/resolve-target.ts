import { parseConversationTarget } from '@lynku/contracts'

export interface AnonymousConversationContext {
  protocol_version: 3
  source_type: 'post' | 'comment' | 'user'
  source_id: string
  target_openid: string
  initiator_openid: string
  thread_id: string
  initiator_visibility: 'anonymous' | 'real'
  target_visibility: 'anonymous' | 'real'
}

export interface TargetStore {
  source(type: 'post' | 'comment' | 'user', id: string): Promise<unknown | null>
  directory(owner: string, conversationId: string): Promise<unknown | null>
  identifier(...parts: string[]): string
}

export class InvalidConversationTarget extends Error {}
export class ConversationTargetNotFound extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored conversation')
  return value as Record<string, unknown>
}

function visibility(value: unknown): 'anonymous' | 'real' | null {
  return value === 'anonymous' || value === 'real' ? value : null
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
  const threadId = 'thread_id' in target ? target.thread_id
    : store.identifier('anonymous-initiation', owner, target.type, target.id, target.initiation_id)
  {
    const conversationId = store.identifier('conversation', 'anonymous', threadId)
    const value = await store.directory(owner, conversationId)
    if (value !== null) {
      const entry = record(value)
      const context = record(entry.anonymous_context)
      if (entry.owner_openid !== owner || entry.conversation_id !== conversationId
        || context.protocol_version !== 3 || context.thread_id !== threadId
        || !['post', 'comment', 'user'].includes(String(context.source_type)) || typeof context.source_id !== 'string'
        || typeof context.initiator_openid !== 'string' || !context.initiator_openid
        || typeof context.target_openid !== 'string' || !context.target_openid
        || context.initiator_openid === context.target_openid
        || !visibility(context.initiator_visibility) || !visibility(context.target_visibility)) throw new ConversationTargetNotFound('Conversation not found')
      const peer = owner === context.initiator_openid ? context.target_openid
        : owner === context.target_openid ? context.initiator_openid : null
      if (!peer || entry.peer_openid !== peer) {
        throw new ConversationTargetNotFound('Conversation not found')
      }
      return { peer, anonymousContext: { protocol_version: 3, source_type: context.source_type as AnonymousConversationContext['source_type'], source_id: context.source_id,
        target_openid: context.target_openid, initiator_openid: context.initiator_openid, thread_id: threadId,
        initiator_visibility: visibility(context.initiator_visibility)!, target_visibility: visibility(context.target_visibility)! } }
    }
  }
  if ('thread_id' in target) throw new ConversationTargetNotFound('Conversation not found')
  const value = await store.source(target.type, target.id)
  if (value === null) throw new ConversationTargetNotFound('Source not found')
  const source = record(value)
  if ((target.type === 'user' ? source._openid !== target.id : source._id !== target.id || source.status !== 'published')
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
  const targetVisibility = target.type === 'user' ? 'real' : source.anonymous === true ? 'anonymous' : 'real'
  if (target.expected_target_visibility !== undefined && target.expected_target_visibility !== targetVisibility) throw new InvalidConversationTarget('Conversation visibility changed')
  return { peer: source._openid, anonymousContext: { protocol_version: 3, source_type: target.type, source_id: target.id,
    target_openid: source._openid, initiator_openid: owner, thread_id: threadId,
    initiator_visibility: target.initiator_visibility, target_visibility: targetVisibility } }
}
