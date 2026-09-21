export interface PostFields { title: string; content: string; category_id: string; anonymous: boolean }
export interface CreatePostRequest extends PostFields { request_id: string }
export interface UpdatePostRequest extends PostFields { post_id: string; expected_revision: number }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid post request')
  return value as Record<string, unknown>
}
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw new Error('Invalid post text')
  const result = value.trim()
  if (result.length < min || result.length > max) throw new Error('Invalid post text')
  return result
}
function fields(input: Record<string, unknown>): PostFields {
  if (typeof input.anonymous !== 'boolean') throw new Error('Invalid post anonymity')
  return { title: text(input.title, 1, 200), content: text(input.content, 1, 10000),
    category_id: text(input.category_id === undefined ? '' : input.category_id, 0, 128), anonymous: input.anonymous }
}
export function parseCreatePostRequest(value: unknown): CreatePostRequest {
  const input = object(value)
  return { ...fields(input), request_id: text(input.request_id, 8, 128) }
}
export function parseUpdatePostRequest(value: unknown): UpdatePostRequest {
  const input = object(value)
  if (typeof input.expected_revision !== 'number' || !Number.isSafeInteger(input.expected_revision)
    || input.expected_revision < 1 || input.expected_revision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid post revision')
  return { ...fields(input), post_id: text(input.post_id, 1, 128), expected_revision: input.expected_revision }
}
