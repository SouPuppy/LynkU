import * as session from './session'
// services/cloud.ts — CloudBase cloud function caller
// Typed wrapper around wx.cloud.callFunction().

export class CloudCallError extends Error {
  code: string
  functionName: string
  action: string
  constructor(message: string, code: string, functionName = '', action = '') {
    super(message)
    this.name = 'CloudCallError'
    this.code = code
    this.functionName = functionName
    this.action = action
  }
}

function cloudContext(name: string, data: Record<string, unknown>) {
  const action = typeof data.action === 'string' ? data.action : ''
  return {
    action,
    label: action ? `${name}.${action}` : name,
  }
}

/**
 * Typed cloud function call. Handles both:
 * - SDK errors (function not found, env not configured, network)
 * - Business errors (returned by cloud function via {error, code})
 */
export async function callCloud<T>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const publicRead = (name === 'posts' && ['list', 'get', 'search'].includes(String(data.action)))
    || (name === 'comments' && ['list', 'syncChanges'].includes(String(data.action)))
  if (publicRead && !session.isLoggedIn()) data = { ...data, public_only: true }
  if ((name === 'messages' || name === 'drafts' || (name === 'posts' && data.action === 'listMine')) && session.getState() !== 'verified') {
    throw new CloudCallError('请先登录并完成学校认证', 'EMAIL_NOT_VERIFIED', name, String(data.action || ''))
  }
  let res: ICloud.CallFunctionResult
  const context = cloudContext(name, data)

  try {
    res = await wx.cloud.callFunction({ name, data })
  } catch (e: unknown) {
    // SDK-level: network failure, function not found, env not configured
    const err = e as { errCode?: number; errMsg?: string; message?: string }
    const msg = err.errMsg || err.message || String(e)
    const code = String(err.errCode || 'SDK_ERROR')

    if (err.errCode === -1) {
      throw new CloudCallError(
        '服务暂时不可用，请稍后重试',
        'FUNCTION_NOT_FOUND',
        name,
        context.action,
      )
    }
    if (err.errCode === -501001 || msg.includes('Environment') || msg.includes('env')) {
      throw new CloudCallError(
        '服务暂时不可用，请稍后重试',
        'ENV_NOT_CONFIGURED',
        name,
        context.action,
      )
    }
    if (msg.includes('timeout') || msg.includes('network')) {
      throw new CloudCallError(
        '网络连接失败，请稍后重试',
        'NETWORK_ERROR',
        name,
        context.action,
      )
    }

    throw new CloudCallError('服务请求失败，请稍后重试', code, name, context.action)
  }

  // Business-level errors returned by cloud function
  const result = res.result as Record<string, unknown> | null | undefined

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    const code = String(result.code || 'UNKNOWN')
    const message = code === 'UNKNOWN_ACTION'
      ? `云函数 ${context.label} 不支持该操作，请确认已部署最新版本`
      : String(result.error)
    throw new CloudCallError(
      message,
      code,
      name,
      context.action,
    )
  }

  // Unwrap {data: ...} envelope
  if (result && typeof result === 'object' && 'data' in result && result.data !== undefined) {
    return result.data as T
  }

  throw new CloudCallError(
    '服务返回异常，请稍后重试',
    'INVALID_RESPONSE',
    name,
    context.action,
  )
}

export default callCloud
