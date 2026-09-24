import { ANONYMOUS_AVATAR } from './avatar'
import { POST_CONTENT_LIMIT } from './content-limits'
export interface PostView {
  _id: string
  _openid?: string
  is_mine: boolean
  title: string
  content: string
  category_id: string
  category: { _id: string; name: string } | null
  status: 'published' | 'flagged'
  author: { _openid?: string; nickname: string; avatar_url: string }
  anonymous: boolean
  view_count: number
  comment_count: number
  created_at: string
  updated_at: string
  revision: number
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid post response')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || value.length > max) throw new Error('Invalid post text')
  return value
}
function count(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new Error('Invalid post count')
  return value
}
function time(value: unknown): string {
  const result = text(value, 30)
  if (new Date(result).toISOString() !== result) throw new Error('Invalid post timestamp')
  return result
}
export function parsePostView(value: unknown): PostView {
  const input = object(value)
  if ((input.status !== 'published' && input.status !== 'flagged') || typeof input.anonymous !== 'boolean'
    || typeof input.is_mine !== 'boolean') throw new Error('Invalid post state')
  const actor = input.anonymous ? { nickname: '匿名用户', avatar_url: ANONYMOUS_AVATAR } : object(input.author)
  const result: PostView = { _id: text(input._id, 128), is_mine: input.is_mine, title: text(input.title, 200),
    content: text(input.content, POST_CONTENT_LIMIT), category_id: text(input.category_id, 128, true), category: null,
    status: input.status, anonymous: input.anonymous,
    author: { nickname: text(actor.nickname, 100), avatar_url: text(actor.avatar_url, 2048, true) },
    view_count: count(input.view_count), comment_count: count(input.comment_count), revision: count(input.revision, 1),
    created_at: time(input.created_at), updated_at: time(input.updated_at) }
  if (!input.anonymous) {
    result._openid = text(input._openid, 128)
    result.author._openid = result._openid
  }
  if (input.category !== null && input.category !== undefined) {
    const category = object(input.category)
    result.category = { _id: text(category._id, 128), name: text(category.name, 100) }
    if (result.category._id !== result.category_id) throw new Error('Invalid post category')
  }
  return result
}
export function parsePostPage(value: unknown, scope: 'public' | 'owner' = 'public'): { items: PostView[]; total: number; hasMore: boolean } {
  const input = object(value)
  if (!Array.isArray(input.items) || input.items.length > 50 || typeof input.hasMore !== 'boolean') throw new Error('Invalid post page')
  const items = input.items.map(parsePostView)
  const total = count(input.total)
  if (total < items.length || items.some(item => scope === 'public' ? item.status !== 'published' : !item.is_mine)
    || new Set(items.map(item => item._id)).size !== items.length) throw new Error('Invalid post page boundary')
  return { items, total, hasMore: input.hasMore }
}
