export type ErrorCode =
  | 'AGREEMENT_NOT_READY'
  | 'AGREEMENT_CHANGED'
  | 'ACCOUNT_CLOSED'
  | 'AUTH_FAILED'
  | 'AUTH_UNAVAILABLE'
  | 'CODE_EXPIRED'
  | 'CODE_NOT_FOUND'
  | 'CREATE_ERROR'
  | 'DELETE_ERROR'
  | 'DRAFT_LIMIT_REACHED'
  | 'DRAFT_CONFLICT'
  | 'DUPLICATE_NAME'
  | 'EMAIL_IN_USE'
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_RATE_LIMITED'
  | 'EMAIL_SEND_FAILED'
  | 'EMAIL_VERIFICATION_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'INVALID_CATEGORY'
  | 'INVALID_CODE'
  | 'INVALID_EMAIL'
  | 'INVALID_INPUT'
  | 'MAX_DEPTH'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CONTENT_REJECTED'
  | 'MODERATION_UNAVAILABLE'
  | 'OPERATION_ERROR'
  | 'PARENT_MISMATCH'
  | 'POST_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'RATE_LIMIT_UNAVAILABLE'
  | 'QUERY_ERROR'
  | 'SAVE_ERROR'
  | 'SEARCH_ERROR'
  | 'SEND_ERROR'
  | 'TOO_MANY_ATTEMPTS'
  | 'UNKNOWN_ACTION'
  | 'UPDATE_ERROR'
  | 'VERIFY_ERROR'

export interface ApiFailure {
  ok: false
  code: ErrorCode
  message: string
  requestId?: string
  retryAfter?: number
}

export interface ApiSuccess<T> {
  ok: true
  data: T
  requestId?: string
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure

export function success<T>(data: T, requestId?: string): ApiSuccess<T> {
  return requestId === undefined ? { ok: true, data } : { ok: true, data, requestId }
}

export function failure(
  code: ErrorCode,
  message: string,
  options: { requestId?: string; retryAfter?: number } = {},
): ApiFailure {
  return {
    ok: false,
    code,
    message,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  }
}
