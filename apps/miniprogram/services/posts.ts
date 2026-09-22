// services/posts.ts — Post data access
// All reads and writes go through cloud functions so anonymous ownership stays private.

import type { IPost, ICreatePostData } from '../typings/cloudbase'
import { callCloud, CloudCallError } from './cloud'
import { getRevision } from './session'
import { parseOwnedPostPage, type OwnedPostCursor, type OwnedPostPage } from '../generated/contracts/index'
import { parsePostMutationReceipt, parsePostView, parsePublicPostPage, type PostMutationReceipt, type PostCursor, type PublicPostPage } from '../generated/contracts/index'

const PAGE_SIZE = 20

/** List published posts, optionally filtered by category and/or author */
export async function listPosts(params: {
  categoryId?: string
  authorOpenid?: string
  cursor?: PostCursor | null
  limit?: number
}): Promise<PublicPostPage> {
  const { categoryId, authorOpenid, cursor = null, limit = PAGE_SIZE } = params
  return readPostPage('posts', {
    action: 'list',
    category_id: categoryId,
    author_openid: authorOpenid,
    cursor,
    limit,
  })
}

/** Get single post by ID. Set skipViewInc=true to skip view count increment (edit mode). */
export async function getPost(postId: string, skipViewInc = false): Promise<IPost | null> {
  const result = await callCloud<unknown>('posts', {
    action: 'get',
    post_id: postId,
    for_edit: skipViewInc,
    skip_view_inc: skipViewInc,
  })
  try {
    if (!result || typeof result !== 'object' || !('post' in result)) throw new Error('Missing post')
    const post = parsePostView(result.post)
    if (post._id !== postId) throw new Error('Wrong post')
    return post
  } catch (_) { throw new CloudCallError('帖子返回了无效数据', 'INVALID_RESPONSE', 'posts', 'get') }
}

/** Create post via cloud function */
export async function createPost(
  data: ICreatePostData,
  anonymous = false,
  requestId?: string,
): Promise<PostMutationReceipt> {
  const revision = getRevision()
  const result = await callCloud<unknown>('posts', {
    action: 'create',
    title: data.title,
    content: data.content,
    category_id: data.category_id,
    anonymous,
    request_id: requestId,
  })
  if (revision !== getRevision()) throw new Error('会话已变更')
  try { return parsePostMutationReceipt(result, 'create') } catch (_) {
    throw new CloudCallError('发布结果未能确认，请重试', 'INVALID_RESPONSE', 'posts', 'create')
  }
}

/** Search posts via cloud function */
export async function searchPosts(
  query: string,
  cursor: PostCursor | null = null,
  limit = PAGE_SIZE,
): Promise<PublicPostPage> {
  return readPostPage('posts', {
    action: 'search',
    query,
    cursor,
    limit,
  })
}

/** Update post via cloud function */
export async function updatePost(
  postId: string,
  data: { title: string; content: string; category_id?: string },
  anonymous = false,
  expectedRevision?: number,
): Promise<PostMutationReceipt> {
  const revision = getRevision()
  const result = await callCloud<unknown>('posts', {
    action: 'update',
    post_id: postId,
    title: data.title,
    content: data.content,
    category_id: data.category_id,
    anonymous,
    expected_revision: expectedRevision,
  })
  if (revision !== getRevision()) throw new Error('会话已变更')
  try { return parsePostMutationReceipt(result, 'update', postId) } catch (_) {
    throw new CloudCallError('修改结果未能确认，请重试', 'INVALID_RESPONSE', 'posts', 'update')
  }
}

/** Delete post (soft) via cloud function */
export async function deletePost(postId: string): Promise<void> {
  await callCloud('posts', { action: 'delete', post_id: postId })
}

async function readPostPage(name: string, data: Record<string, unknown>): Promise<PublicPostPage> {
  const revision = getRevision()
  const result = await callCloud<unknown>(name, data)
  if (revision !== getRevision()) throw new Error('会话已变更')
  try { return parsePublicPostPage(result) } catch (_) {
    throw new CloudCallError('帖子列表返回了无效数据', 'INVALID_RESPONSE', name, String(data.action))
  }
}

export async function listMyPosts(cursor: OwnedPostCursor | null = null, limit = PAGE_SIZE): Promise<OwnedPostPage> {
  const revision = getRevision()
  const result = await callCloud<unknown>('posts', { action: 'listMine', cursor, limit })
  if (revision !== getRevision()) throw new Error('会话已变更')
  try { return parseOwnedPostPage(result) } catch (_) {
    throw new CloudCallError('帖子列表返回了无效数据', 'INVALID_RESPONSE', 'posts', 'listMine')
  }
}
