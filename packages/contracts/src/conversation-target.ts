export type AnonymousChatTarget =
  | { anonymous: true; thread_id: string }
  | { anonymous: true; type: 'post' | 'comment' | 'user'; id: string; initiation_id: string; initiator_visibility: 'anonymous' | 'real' }

export function parseAnonymousChatTarget(value: unknown): AnonymousChatTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid anonymous target')
  const input = value as Record<string, unknown>
  if (input.thread_id !== undefined) {
    if (Object.keys(input).some(key => key !== 'anonymous' && key !== 'thread_id')
      || typeof input.thread_id !== 'string' || !/^[a-f0-9]{64}$/.test(input.thread_id)) throw new Error('Invalid anonymous thread')
    return { anonymous: true, thread_id: input.thread_id }
  }
  if (Object.keys(input).some(key => !['anonymous', 'type', 'id', 'initiation_id', 'initiator_visibility'].includes(key))
    || (input.type !== 'post' && input.type !== 'comment' && input.type !== 'user') || typeof input.id !== 'string'
    || !input.id || input.id.length > 128 || input.id.trim() !== input.id) throw new Error('Invalid anonymous target')
  if (typeof input.initiation_id !== 'string' || !/^[a-zA-Z0-9_-]{24,96}$/.test(input.initiation_id)) throw new Error('Invalid initiation ID')
  if (input.initiator_visibility !== 'anonymous' && input.initiator_visibility !== 'real') throw new Error('Invalid anonymous visibility')
  return { anonymous: true, type: input.type, id: input.id, initiation_id: input.initiation_id, initiator_visibility: input.initiator_visibility }
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
