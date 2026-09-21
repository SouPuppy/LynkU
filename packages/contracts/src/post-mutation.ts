/** Minimal receipt required before the editor may consider a mutation confirmed. */
export interface PostMutationReceipt {
  post: { _id: string; revision: number; status: 'published' | 'flagged' }
  flagged: boolean
  status?: 'created' | 'duplicate'
}
export function parsePostMutationReceipt(value: unknown, operation: 'create' | 'update', expectedId?: string): PostMutationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid post mutation receipt')
  const input = value as Record<string, unknown>
  if (!input.post || typeof input.post !== 'object' || Array.isArray(input.post)) throw new Error('Missing post receipt')
  const post = input.post as Record<string, unknown>
  if (typeof post._id !== 'string' || !post._id || post._id.length > 128
    || (expectedId !== undefined && post._id !== expectedId)
    || typeof post.revision !== 'number' || !Number.isSafeInteger(post.revision) || post.revision < 1
    || (post.status !== 'published' && post.status !== 'flagged')
    || typeof input.flagged !== 'boolean' || input.flagged !== (post.status === 'flagged')) throw new Error('Invalid post receipt state')
  if (operation === 'create' && input.status !== 'created' && input.status !== 'duplicate') throw new Error('Invalid create confirmation')
  const result: PostMutationReceipt = { post: { _id: post._id, revision: post.revision, status: post.status }, flagged: input.flagged }
  if (operation === 'create') result.status = input.status as 'created' | 'duplicate'
  return result
}
