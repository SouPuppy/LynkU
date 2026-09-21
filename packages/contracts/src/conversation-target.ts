export interface AnonymousChatTarget {
  anonymous: true
  type: 'post' | 'comment'
  id: string
  thread_id?: string
}

export function parseAnonymousChatTarget(value: unknown): AnonymousChatTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid anonymous target')
  const input = value as Record<string, unknown>
  if ((input.type !== 'post' && input.type !== 'comment') || typeof input.id !== 'string'
    || !input.id || input.id.length > 128 || input.id.trim() !== input.id) throw new Error('Invalid anonymous target')
  const target: AnonymousChatTarget = { anonymous: true, type: input.type, id: input.id }
  if (input.thread_id !== undefined) {
    if (typeof input.thread_id !== 'string' || !/^[a-f0-9]{64}$/.test(input.thread_id)) throw new Error('Invalid anonymous thread')
    target.thread_id = input.thread_id
  }
  return target
}

export function parseConversationTarget(value: unknown): { peer: string } | { target: AnonymousChatTarget } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation target')
  const input = value as Record<string, unknown>
  if (input.anonymousTarget !== undefined || (input.peer !== undefined && input.to !== undefined)) throw new Error('Ambiguous conversation target')
  const peer = input.peer === undefined ? input.to : input.peer
  if (input.anonymous_target !== undefined) {
    if (peer !== undefined) throw new Error('Ambiguous conversation target')
    return { target: parseAnonymousChatTarget(input.anonymous_target) }
  }
  if (typeof peer !== 'string' || peer.length < 8 || peer.length > 128 || peer.trim() !== peer) throw new Error('Invalid peer')
  return { peer }
}
