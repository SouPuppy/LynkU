import type { EditorCategory } from './ports'

export type EditorMode = 'create' | 'edit' | 'draft'
export interface EditorRoute { mode: EditorMode; postId: string; draftId: string }
export interface EditorState {
  mode: EditorMode
  title: string
  content: string
  categoryId: string
  categories: EditorCategory[]
  categoriesReady: boolean
  submitting: boolean
  publicationPending: boolean
  draftId: string
  lastSavedAt: string
  titleLen: number
  contentLen: number
  dirty: boolean
  anonymousMode: boolean
}
export type EditorEvent = { type: 'notice'; message: string; success: boolean }
  | { type: 'recovery-available' } | { type: 'published' } | { type: 'close' }
export interface EditorObserver { state(state: EditorState): void; event(event: EditorEvent): void }

export function initialEditorState(): EditorState {
  return { mode: 'create', title: '', content: '', categoryId: '', categories: [], categoriesReady: false,
    submitting: false, publicationPending: false, draftId: '', lastSavedAt: '', titleLen: 0,
    contentLen: 0, dirty: false, anonymousMode: false }
}

export function parseEditorRoute(options: Record<string, unknown>): EditorRoute {
  const id = (value: unknown): string => typeof value === 'string' && value.length <= 128 ? value : ''
  const postId = id(options.post_id), draftId = id(options.draft_id)
  if (options.mode === 'edit' && postId) return { mode: 'edit', postId, draftId: '' }
  if (options.mode === 'draft' && draftId) return { mode: 'draft', postId: '', draftId }
  return { mode: 'create', postId: '', draftId: '' }
}
