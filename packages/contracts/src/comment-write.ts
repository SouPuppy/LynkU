export interface CreateCommentRequest {
  post_id: string
  parent_id: string | null
  content: string
  anonymous: boolean
  request_id: string
}

export function parseCreateCommentRequest(value: unknown): CreateCommentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid comment request')
  const input = value as Record<string, unknown>
  const text = (value: unknown, max: number, min = 1): string => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error('Invalid comment field')
    return value.trim()
  }
  if (typeof input.anonymous !== 'boolean') throw new Error('Invalid comment anonymity')
  return { post_id: text(input.post_id, 128), content: text(input.content, 2000),
    parent_id: input.parent_id === undefined || input.parent_id === null ? null : text(input.parent_id, 128),
    anonymous: input.anonymous, request_id: text(input.request_id, 128, 8) }
}
