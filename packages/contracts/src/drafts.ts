import { POST_CONTENT_LIMIT, POST_TITLE_LIMIT } from './content-limits'
export interface Draft {
  _id: string
  title: string
  content: string
  category_id: string
  anonymous: boolean
  revision: number
  created_at: string
  updated_at: string
}
export interface SaveDraftRequest {
  draft_id?: string
  expected_revision?: number
  request_id?: string
  title: string
  content: string
  category_id: string
  anonymous: boolean
}
export interface SaveDraftResponse { draft: Draft; status?: 'created' | 'duplicate' }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid draft object')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, min = 0): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error('Invalid draft text')
  return value
}
export function parseDraftId(value: unknown): string { return text(value, 128, 1) }
export function parseDraftSave(value: unknown): SaveDraftRequest {
  const input = object(value)
  if (typeof input.anonymous !== 'boolean') throw new Error('Invalid draft anonymity')
  const result: SaveDraftRequest = { title: text(input.title, POST_TITLE_LIMIT), content: text(input.content, POST_CONTENT_LIMIT),
    category_id: text(input.category_id, 128), anonymous: input.anonymous }
  if (input.draft_id !== undefined) {
    result.draft_id = parseDraftId(input.draft_id)
    if (typeof input.expected_revision !== 'number' || !Number.isSafeInteger(input.expected_revision)
      || input.expected_revision < 1 || input.expected_revision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid draft revision')
    result.expected_revision = input.expected_revision
    if (input.request_id !== undefined) throw new Error('Ambiguous draft save')
  } else {
    result.request_id = text(input.request_id, 128, 8)
    if (input.expected_revision !== undefined) throw new Error('Ambiguous draft save')
  }
  return result
}
export function parseDraft(value: unknown): Draft {
  const input = object(value)
  if (typeof input.anonymous !== 'boolean' || typeof input.revision !== 'number'
    || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('Invalid draft state')
  const time = (value: unknown): string => {
    const result = text(value, 30, 1)
    if (new Date(result).toISOString() !== result) throw new Error('Invalid draft time')
    return result
  }
  return { _id: parseDraftId(input._id), title: text(input.title, POST_TITLE_LIMIT), content: text(input.content, POST_CONTENT_LIMIT),
    category_id: text(input.category_id, 128), anonymous: input.anonymous, revision: input.revision,
    created_at: time(input.created_at), updated_at: time(input.updated_at) }
}
export function parseDraftList(value: unknown): Draft[] {
  const input = object(value)
  if (!Array.isArray(input.drafts) || input.drafts.length > 50) throw new Error('Invalid draft list')
  const drafts = input.drafts.map(parseDraft)
  if (new Set(drafts.map(draft => draft._id)).size !== drafts.length) throw new Error('Duplicate draft')
  return drafts
}
