export interface ReadPostRequest { post_id: string; for_edit: boolean; skip_view_inc: boolean }
export function parseReadPostRequest(value: unknown): ReadPostRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid post request')
  const input = value as Record<string, unknown>
  if (typeof input.post_id !== 'string' || !input.post_id || input.post_id.length > 128 || input.post_id.trim() !== input.post_id) throw new Error('Invalid post ID')
  for (const key of ['for_edit', 'skip_view_inc', 'public_only'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('Invalid post request flag')
  }
  return { post_id: input.post_id, for_edit: input.for_edit === true, skip_view_inc: input.skip_view_inc === true }
}
