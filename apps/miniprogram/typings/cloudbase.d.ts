// Transitional client views. Public/self DTOs come from shared contracts;
// private database records belong to the server and persistence adapters.
import type { ConversationSummary, PublicNotification, Draft, PostView } from '../generated/contracts/index'
import type { SelfProfile, PublicProfile } from '../generated/contracts/index'

// ── User ──
export type IUserPublic = PublicProfile

export type ISelfProfile = SelfProfile

// ── Post ──
export interface IPost extends PostView {}

export interface ICreatePostData {
  title: string          // 1-200 chars
  content: string        // 1-10000 chars
  category_id?: string
}

// ── Comment ──
export type IComment = import('../generated/contracts/index').CommentView

// nest reply for client-side tree
export interface ICommentWithReplies extends IComment {
  replies: IComment[]
}

export interface ICommentChangeCursor {
  version: 1
  post_id: string
  sequence: number
}

export interface ICommentChange {
  comment_id: string
  sequence: number
  type: 'created' | 'deleted'
  comment: IComment | null
}

// ── Message ──
export interface IMessage {
  _id: string
  msg_id: string         // unique, client-generated for idempotency
  from: string           // sender openid
  to: string             // recipient openid
  content: string        // 1-5000 chars
  status: 'sent' | 'delivered' | 'read'
  created_at: Date | string
  updated_at?: Date
  conversation_id?: string
  sync_sequence?: number
}

export interface IMessageSyncCursor {
  version: 2
  conversation_id: string
  sequence: number
}

export type IAnonymousChatTarget = import('../generated/contracts/index').AnonymousChatTarget

export interface IConversation extends ConversationSummary {
  conversationKey?: string
  display_time?: string
  peerAnonymous?: boolean
}

// ── Category ──
export interface ICategory {
  _id: string
  name: string
  description: string
  sort_order: number
  post_count: number
  status: 'active' | 'hidden'
}

// ── Notification ──
export type NotificationType = 'comment' | 'reply' | 'like' | 'follow' | 'system'

export interface INotification extends PublicNotification {}

// ── Editor ──
export type EditorMode = 'create' | 'edit' | 'draft'

export interface IDraft extends Draft {}

export interface IUpdatePostData {
  title: string
  content: string
  category_id?: string
}

// ── LoadState ──
export type LoadState = 'idle' | 'loading' | 'loaded' | 'empty' | 'error'

// ── Pagination ──
export interface PaginatedResult<T> {
  items: T[]
  total?: number
  hasMore?: boolean
}
