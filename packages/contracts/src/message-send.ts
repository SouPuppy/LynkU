import { parsePublicMessage, type PublicMessage } from './message-history'

export function parseSendMessageRequest(value: unknown): { content: string; msg_id: string } {
  if (!value || typeof value !== 'object' || !('content' in value) || !('msg_id' in value)
    || typeof value.content !== 'string' || typeof value.msg_id !== 'string') throw new Error('Invalid send request')
  const content = value.content.trim()
  const msg_id = value.msg_id.trim()
  if (!content || content.length > 5000 || !msg_id || msg_id.length > 128) throw new Error('Invalid send request')
  return { content, msg_id }
}

export interface SendMessageResponse { message: PublicMessage; status: 'sent' | 'duplicate' }

export function parseSendMessageResponse(value: unknown): SendMessageResponse {
  if (!value || typeof value !== 'object' || !('status' in value) || !('message' in value)
    || (value.status !== 'sent' && value.status !== 'duplicate')) throw new Error('Invalid send response')
  return { message: parsePublicMessage(value.message), status: value.status }
}
