import { parseLegalManifest } from '@lynku/contracts'
import cloudbase from '@cloudbase/js-sdk'
import { parseCategoryCreation, type CategoryCreation } from '@lynku/contracts'
import { parseRestoreGovernedPostReceipt, parseRestoreGovernedPostRequest, type RestoreGovernedPostRequest } from '@lynku/contracts'
import { parseOperationRetry, parseOperationRetryReceipt, type OperationRetry } from '@lynku/contracts'
import { parseOperationQuery, parseOperationPage, parseOperationTask, type OperationQuery, type OperationKind } from '@lynku/contracts'
import { parseAdminCaseQuery, parseAdminCasePage, type AdminCaseQuery } from '@lynku/contracts'
import { parseAccountRestrictions, parseRestrictionChange, type RestrictionChange } from '@lynku/contracts'
import { parseAdminMembers, parseAdminMember, parseAdminMemberChange, type AdminMemberChange } from '@lynku/contracts'
import { AdminSessionScope } from './session-scope'
import { parseCaseDetail, parseCloseCaseRequest, type CloseCaseRequest } from '@lynku/contracts'
import { parseAdminCommentPage, parseAdminCommentDetail, type CommentHistoryCursor } from '@lynku/contracts'
import { parseAdminPostPage, parseAdminPostQuery, parseAdminPostDetail, parseAdminPostId, type AdminPostQuery } from '@lynku/contracts'
import { parseAdminUserDetail, parseAdminUserPage, parseAdminUserQuery, type AdminUserQuery } from '@lynku/contracts'
import { parseManagedCategoryList, parseCategoryChange, parseCategoryChangeReceipt, type ManagedCategory, type CategoryChange } from '@lynku/contracts'

export type AdminSession = { accountId: string; capabilities: string[]; memberVersion: number; role: 'owner' | 'community' | 'viewer' }
export type AdminCategory = ManagedCategory
export type AdminOverview = { metrics: Record<'users' | 'verifiedUsers' | 'posts' | 'openCases', { value: number | null; state: 'available' | 'unavailable' | 'forbidden' }>; observedAt: string }
export type AdminUser = { id: string; displayName: string; email: string; verified: boolean; role: string; createdAt: string }
type CloudResult<T> = { code?: string; message?: string; result?: { code?: string; error?: string; data?: T } }
const app = cloudbase.init({ env: __LYNKU_CLOUDBASE_ENV__, auth: { detectSessionInUrl: true } })
const sessionScope = new AdminSessionScope()
let logout: Promise<void> = Promise.resolve()
export const onSessionEnded = (listener: () => void) => sessionScope.subscribe(listener)

async function invoke<T>(data: object): Promise<CloudResult<T>> {
  const generation = sessionScope.capture()
  const response = await app.callFunction({ name: 'admin', data, parse: true }) as unknown as CloudResult<T>
  sessionScope.assert(generation)
  const code = response.result?.code || response.code
  if (code === 'AUTH_FAILED' || code === 'FORBIDDEN') sessionScope.invalidate()
  return response
}

export async function signIn(identifier: string, password: string): Promise<void> {
  await logout
  const generation = sessionScope.begin()
  const result = await app.auth().signInWithPassword({ username: identifier, password })
  sessionScope.assert(generation)
  if (result.error) throw Error(result.error.message || '登录未完成')
}

export function signOut(): Promise<void> {
  sessionScope.invalidate()
  logout = app.auth().signOut().then(() => undefined)
  // Keep the next login available even when the network logout fails.
  void logout.catch(() => { logout = Promise.resolve() })
  return logout
}

export async function currentSession(): Promise<AdminSession | null> {
  const generation = sessionScope.capture()
  const login = await app.auth().getSession()
  sessionScope.assert(generation)
  if (login.error || !login.data?.session) return null
  let response: CloudResult<AdminSession>
  try { response = await invoke<AdminSession>({ action: 'session' }) } catch (error) { throw Error(error instanceof Error ? error.message : '请求暂时无法完成') }
  if (response.code) throw Error(response.message || '后台身份验证失败')
  const result = response.result
  if (!result || result.code || result.error || !result.data) throw Error(result?.error || '当前账号没有后台权限')
  const session = result.data
  if (typeof session.accountId !== 'string' || !Array.isArray(session.capabilities) || !session.capabilities.every(value => typeof value === 'string') || !Number.isSafeInteger(session.memberVersion) || (session.role !== 'owner' && session.role !== 'community' && session.role !== 'viewer')) throw Error('后台返回了无效会话')
  return session
}

export async function listCategories(): Promise<AdminCategory[]> {
  const response = await invoke<{ categories: AdminCategory[] }>({ action: 'listCategories' })
  const result = response.result
  if (response.code || !result || result.code || result.error || !result.data || !Array.isArray(result.data.categories)) throw Error(response.message || result?.error || '分类暂时无法加载')
  return parseManagedCategoryList(result.data)
}

export class AdminRequestError extends Error {
  constructor(message: string, readonly code: string, readonly uncertain: boolean) { super(message) }
}
export async function listMembers() {
  const result = await read<{ members: unknown }>('listMembers')
  return parseAdminMembers(result.members)
}
export async function readUserProtection(accountId: string) {
  const result = await read<{ user: unknown; restrictions: unknown }>('readUserProtection', { accountId })
  const user = parseAdminUserDetail(result.user)
  if (user.id !== accountId) throw Error('用户详情不匹配')
  return { user, restrictions: parseAccountRestrictions(result.restrictions) }
}
export async function updateUserProtection(input: RestrictionChange) {
  const request = parseRestrictionChange(input)
  let response: CloudResult<unknown>
  try { response = await invoke({ ...request, action: 'updateUserProtection' }) }
  catch { throw new AdminRequestError('提交结果未确认，请重试原请求。', 'UNCONFIRMED', true) }
  const result = response.result
  if (response.code || !result || result.code || result.error) {
    const code = result?.code || response.code || 'UNCONFIRMED'
    throw new AdminRequestError(result?.error || response.message || '限制修改未完成', code, !['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'AUTH_FAILED'].includes(code))
  }
  try {
    const restrictions = parseAccountRestrictions(result.data)
    if (restrictions.version !== request.expectedVersion + 1 || restrictions[request.capability] !== request.until) throw Error('Wrong receipt')
    return restrictions
  } catch { throw new AdminRequestError('回执未确认，请重试原请求。', 'UNCONFIRMED', true) }
}
export async function updateMember(input: AdminMemberChange) {
  const request = parseAdminMemberChange(input)
  let response: CloudResult<unknown>
  try { response = await invoke({ ...request, action: 'updateMember' }) }
  catch { throw new AdminRequestError('提交结果未确认，请重试原请求。', 'UNCONFIRMED', true) }
  const result = response.result
  if (response.code || !result || result.code || result.error) {
    const code = result?.code || response.code || 'UNCONFIRMED'
    throw new AdminRequestError(result?.error || response.message || '修改未完成', code, !['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'AUTH_FAILED'].includes(code))
  }
  try {
    const member = parseAdminMember(result.data)
    if (member.id !== request.id || member.version !== request.expectedVersion + 1 || member.role !== request.role || member.status !== request.status) throw Error('Receipt mismatch')
    return member
  } catch { throw new AdminRequestError('回执未确认，请重试原请求。', 'UNCONFIRMED', true) }
}
export async function readCase(id: string) {
  const result = parseCaseDetail(await read<unknown>('readCase', { id }))
  if (result.id !== id) throw Error('案件详情不匹配')
  return result
}
export async function readComment(id: string) {
  const result = parseAdminCommentDetail(await read<unknown>('readComment', { id }))
  if (result._id !== id) throw Error('评论预览不匹配')
  return result
}
export async function closeCase(input: CloseCaseRequest) {
  const request = parseCloseCaseRequest(input)
  let response: CloudResult<unknown>
  try { response = await invoke<unknown>({ ...request, action: 'closeCase' }) }
  catch { throw new AdminRequestError('结果未确认，请重试确认原请求。', 'UNCONFIRMED', true) }
  const result = response.result
  if (response.code || !result || result.code || result.error) {
    const code = result?.code || response.code || 'UNCONFIRMED'
    throw new AdminRequestError(result?.error || response.message || '案件处理未完成', code, !['CONFLICT', 'INVALID_INPUT', 'FORBIDDEN', 'NOT_FOUND', 'AUTH_FAILED'].includes(code))
  }
  try {
    const value = parseCaseDetail(result.data)
    if (value.id !== request.id || value.version !== request.expectedVersion + 1 || value.outcome !== request.outcome || value.resolution !== request.reason) throw Error('Case receipt mismatch')
    return value
  } catch { throw new AdminRequestError('回执无法确认，请重试原请求。', 'UNCONFIRMED', true) }
}
export async function restorePost(input: RestoreGovernedPostRequest) {
  const request = parseRestoreGovernedPostRequest(input)
  let response: CloudResult<unknown>
  try { response = await invoke<unknown>({ ...request, action: 'restorePost' }) }
  catch { throw new AdminRequestError('恢复结果未确认，请使用原请求确认。', 'UNCONFIRMED', true) }
  const result = response.result
  if (response.code || !result || result.code || result.error) {
    const code = result?.code || response.code || 'UNCONFIRMED'
    throw new AdminRequestError(result?.error || response.message || '恢复未完成', code, !['CONFLICT', 'INVALID_INPUT', 'INVALID_CATEGORY', 'FORBIDDEN', 'NOT_FOUND', 'AUTH_FAILED', 'CONTENT_REJECTED', 'MODERATION_UNAVAILABLE'].includes(code))
  }
  try {
    const receipt = parseRestoreGovernedPostReceipt(result.data)
    if (receipt.requestId !== request.requestId || receipt.post.id !== request.postId || receipt.post.revision !== request.expectedRevision + 1) throw Error('Wrong restoration receipt')
    return receipt
  } catch { throw new AdminRequestError('恢复回执未确认，请使用原请求确认。', 'UNCONFIRMED', true) }
}
export async function updateCategory(input: CategoryChange) {
  const request = parseCategoryChange(input)
  let response: CloudResult<unknown>
  try { response = await invoke<unknown>({ ...request, action: 'updateCategory' }) }
  catch { throw new AdminRequestError('提交结果暂未确认，请使用原请求重试确认。', 'UNCONFIRMED', true) }
  const result = response.result
  if (response.code || !result || result.code || result.error) {
    const code = result?.code || response.code || 'UNCONFIRMED'
    throw new AdminRequestError(result?.error || response.message || '修改未完成', code, !['CONFLICT', 'INVALID_INPUT', 'INVALID_CATEGORY', 'FORBIDDEN', 'NOT_FOUND', 'AUTH_FAILED'].includes(code))
  }
  try {
    const receipt = parseCategoryChangeReceipt(result.data)
    if (receipt.requestId !== request.requestId || receipt.category._id !== request.category._id || receipt.category.managementRevision !== request.category.managementRevision + 1) throw Error('Wrong receipt')
    return receipt
  } catch { throw new AdminRequestError('回执无法确认，请使用原请求重试。', 'UNCONFIRMED', true) }
}
export async function createCategory(input: CategoryCreation) {
  const request = parseCategoryCreation(input)
  let response: CloudResult<unknown>
  try { response = await invoke<unknown>({ ...request, action: 'createCategory' }) }
  catch { throw new AdminRequestError('创建结果未确认，请确认原请求。', 'UNCONFIRMED', true) }
  const result = response.result
  if (response.code || !result || result.code || result.error) {
    const code = result?.code || response.code || 'UNCONFIRMED'
    throw new AdminRequestError(result?.error || response.message || '创建未完成', code, !['CONFLICT', 'INVALID_INPUT', 'INVALID_CATEGORY', 'FORBIDDEN', 'AUTH_FAILED'].includes(code))
  }
  try {
    const receipt = parseCategoryChangeReceipt(result.data)
    if (receipt.requestId !== request.requestId || receipt.category.managementRevision !== 1 || receipt.category.name !== request.name || receipt.category.post_count !== 0) throw Error('Invalid create receipt')
    return receipt
  } catch { throw new AdminRequestError('创建回执未确认，请确认原请求。', 'UNCONFIRMED', true) }
}

async function read<T>(action: string, input: object = {}): Promise<T> {
  const response = await invoke<T>({ ...input, action })
  const result = response.result
  if (response.code || !result || result.code || result.error || !result.data) throw Error(response.message || result?.error || '后台数据暂时无法加载')
  return result.data
}
export async function loadOverview(): Promise<AdminOverview> {
  const result = await read<AdminOverview>('overview')
  if (!result.metrics || typeof result.observedAt !== 'string' || !Number.isFinite(Date.parse(result.observedAt))) throw Error('总览返回格式异常')
  for (const key of ['users', 'verifiedUsers', 'posts', 'openCases'] as const) {
    const metric = result.metrics[key]
    if (!metric || !['available', 'unavailable', 'forbidden'].includes(metric.state)
      || (metric.state === 'available' ? typeof metric.value !== 'number' || !Number.isSafeInteger(metric.value) || metric.value < 0 : metric.value !== null)) throw Error('总览指标格式异常')
  }
  return result
}
export const listPosts = (input: AdminPostQuery) => read<unknown>('listPosts', parseAdminPostQuery(input)).then(parseAdminPostPage)
export const listComments = (postId: string, cursor: CommentHistoryCursor | null) => read<unknown>('listComments', { post_id: postId, cursor, limit: 25 }).then(value => parseAdminCommentPage(value, postId))
export async function readPost(id: string) {
  const requested = parseAdminPostId({ id })
  const result = parseAdminPostDetail(await read<unknown>('readPost', { id: requested }))
  if (result.id !== requested) throw Error('帖子详情响应不匹配')
  return result
}
export const listUsers = (input: AdminUserQuery) => read<unknown>('listUsers', parseAdminUserQuery(input)).then(parseAdminUserPage)
function responseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('后台返回格式异常')
  return value as Record<string, unknown>
}
export const listCases = (input: AdminCaseQuery) => read<unknown>('listCases', parseAdminCaseQuery(input)).then(parseAdminCasePage)
export async function loadOperations() {
  const row = responseObject(await read<unknown>('listOperations'))
  const pendingNotifications = row.pendingNotifications, pendingProfiles = row.pendingProfiles
  if (typeof pendingNotifications !== 'number' || !Number.isSafeInteger(pendingNotifications) || pendingNotifications < 0
    || typeof pendingProfiles !== 'number' || !Number.isSafeInteger(pendingProfiles) || pendingProfiles < 0) throw Error('运行指标异常')
  return { pendingNotifications, pendingProfiles }
}
export const listOperationTasks = (input: OperationQuery) => read<unknown>('listOperationTasks', parseOperationQuery(input)).then(parseOperationPage)
export async function retryOperation(input: OperationRetry) {
  const request = parseOperationRetry(input)
  let response: CloudResult<unknown>
  try { response = await invoke<unknown>({ ...request, action: 'retryOperation' }) }
  catch { throw new AdminRequestError('结果未确认，请使用原请求确认。', 'UNCONFIRMED', true) }
  const result = response.result
  if (response.code || !result || result.code || result.error) {
    const code = result?.code || response.code || 'UNCONFIRMED'
    throw new AdminRequestError(result?.error || response.message || '重试安排未完成', code, !['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'AUTH_FAILED'].includes(code))
  }
  try {
    const receipt = parseOperationRetryReceipt(result.data)
    if (receipt.id !== request.id || receipt.kind !== request.kind || receipt.requestId !== request.requestId || receipt.retryRevision !== request.expectedRetryRevision + 1) throw Error('Retry receipt mismatch')
    return receipt
  } catch { throw new AdminRequestError('回执未确认，请使用原请求确认。', 'UNCONFIRMED', true) }
}
export async function readOperationTask(kind: OperationKind, id: string) {
  const result = parseOperationTask(await read<unknown>('readOperationTask', { kind, id }))
  if (result.kind !== kind || result.id !== id) throw Error('任务详情不匹配')
  return result
}
export const listAudit = (input: AdminAuditQuery) => read<unknown>('listAudit', parseAdminAuditQuery(input)).then(parseAdminAuditPage)
export async function readAudit(id: string) {
  const event = parseAdminAuditEvent(await read<unknown>('readAudit', { id }))
  if (event.id !== id) throw Error('操作记录详情不匹配')
  return event
}
import { parseAdminAuditQuery, parseAdminAuditPage, parseAdminAuditEvent, type AdminAuditQuery } from '@lynku/contracts'

export async function readLegalManifest() { return parseLegalManifest(await read<unknown>('readLegalManifest')) }
