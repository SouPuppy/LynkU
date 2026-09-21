import { parseDraftSave, type SaveDraftRequest } from '../../generated/contracts/index'
export interface PendingPublication { requestId: string; title: string; content: string; categoryId: string; anonymous: boolean }
export interface EditorRecovery {
  version: 2
  mode: 'create' | 'draft' | 'edit'
  postId: string
  postRevision: number
  publication: PendingPublication | null
  owner: string
  title: string
  content: string
  categoryId: string
  anonymous: boolean
  draftId: string
  draftRevision: number
  pendingCreate: SaveDraftRequest | null
}
export function recoveryKey(owner: string): string {
  if (!owner) throw new Error('Missing editor owner')
  return `editor_recovery_v2:${encodeURIComponent(owner)}`
}
export function parseEditorRecovery(value: unknown, owner: string): EditorRecovery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid editor recovery')
  const input = value as Record<string, unknown>
  if (input.version !== 2 || input.owner !== owner || typeof input.draftId !== 'string'
    || input.draftId.length > 128 || typeof input.draftRevision !== 'number' || !Number.isSafeInteger(input.draftRevision)
    || (input.draftId ? input.draftRevision < 1 : input.draftRevision !== 0)) throw new Error('Invalid editor recovery')
  if (typeof input.mode !== 'string' || !['create', 'draft', 'edit'].includes(input.mode) || typeof input.postId !== 'string'
    || input.postId.length > 128 || typeof input.postRevision !== 'number' || !Number.isSafeInteger(input.postRevision)
    || (input.mode === 'edit' ? !input.postId || input.postRevision < 1 : input.postId !== '' || input.postRevision !== 0)) throw new Error('Invalid editor mode')
  const publication = input.publication === null ? null : parsePendingPublication(input.publication)
  if (publication && input.mode === 'edit') throw new Error('Invalid publication mode')
  const fields = parseDraftSave({ title: input.title, content: input.content, category_id: input.categoryId,
    anonymous: input.anonymous, request_id: 'recovery-validation' })
  const pendingCreate = input.pendingCreate === null ? null : parseDraftSave(input.pendingCreate)
  if (pendingCreate && (pendingCreate.draft_id || input.draftId)) throw new Error('Invalid pending draft create')
  return { version: 2, owner, mode: input.mode as EditorRecovery['mode'], postId: input.postId, postRevision: input.postRevision, publication, title: fields.title, content: fields.content, categoryId: fields.category_id,
    anonymous: fields.anonymous, draftId: input.draftId, draftRevision: input.draftRevision, pendingCreate }
}

export function parsePendingPublication(value: unknown): PendingPublication {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid publication')
  const input = value as Record<string, unknown>
  const fields = parseDraftSave({ title: input.title, content: input.content, category_id: input.categoryId,
    anonymous: input.anonymous, request_id: input.requestId })
  if (!fields.title.trim() || !fields.content.trim()) throw new Error('Empty publication')
  return { requestId: fields.request_id!, title: fields.title, content: fields.content,
    categoryId: fields.category_id, anonymous: fields.anonymous }
}
