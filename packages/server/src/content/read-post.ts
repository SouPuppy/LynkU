import { parseReadPostRequest, type PostView } from '@lucky/contracts'
import { projectPost } from './post-view'
export class PostReadFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN') { super(code) }
}
export interface PostReadStore {
  post(id: string): Promise<unknown | null>
  isAdmin(viewer: string): Promise<boolean>
  incrementView(id: string): Promise<void>
}
export async function readPost(store: PostReadStore, viewer: string, input: unknown): Promise<PostView> {
  let request
  try { request = parseReadPostRequest(input) } catch (_) { throw new PostReadFailure('INVALID_INPUT') }
  const value = await store.post(request.post_id)
  if (value === null) throw new PostReadFailure('NOT_FOUND')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored post')
  const row = value as Record<string, unknown>
  if (row._id !== request.post_id) throw new Error('Post ID mismatch')
  const owner = !!viewer && row._openid === viewer
  if (request.for_edit && !owner) throw new PostReadFailure('FORBIDDEN')
  if (row.status !== 'published') {
    if (row.status !== 'flagged') throw new PostReadFailure('NOT_FOUND')
    if (!owner && (!viewer || !(await store.isAdmin(viewer)))) throw new PostReadFailure('NOT_FOUND')
  }
  const post = projectPost(row, viewer)
  // Editing never counts as a public view, even if a caller omits the skip flag.
  if (!request.for_edit && !request.skip_view_inc && post.status === 'published') {
    if (post.view_count >= Number.MAX_SAFE_INTEGER) throw new Error('View count overflow')
    await store.incrementView(post._id)
    return { ...post, view_count: post.view_count + 1 }
  }
  return post
}
