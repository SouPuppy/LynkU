import * as cloud from 'wx-server-sdk'
import { applyAccountRestriction } from './account-restrictions'
import { AccountRestrictionFailure, projectAdminUser } from '@lynku/server'
import { parseAccountRestrictions } from '@lynku/contracts'
import { applyMemberChange } from './member-change'
import { AdminMemberChangeFailure } from '@lynku/server'
import { parseAdminMembers } from '@lynku/contracts'
import { applyCategoryChange } from './category-change'
import { CategoryChangeFailure } from '@lynku/server'
import { readAdminPost, readAdminPosts, AdminPostInputFailure, AdminPostUnavailable } from '@lynku/server'
import { readAdminComments, AdminCommentFailure } from '@lynku/server'
import { readCaseDetail, CaseManagementFailure } from '@lynku/server'
import { PostGovernanceFailure } from '@lynku/server'
import { readGovernanceComment, CommentGovernanceFailure } from '@lynku/server'
import { applyCaseDecision } from './case-decision'
import { readAdminOverview, readAdminUsers, AdminUserInputFailure } from '@lynku/server'
import { authorizeAdmin, AdminAuthorizationFailure, hasAdminCapability, listAdminCategories, projectAdminCase, type AdminAuthorizationStore } from '@lynku/server'
import { connectDatabase, CLOUD_DATABASE_OPTIONS, text, type Row } from '../common/database'
import { fail, ok, stableDocumentId } from '../common'

cloud.init()
const db = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))

type Action = 'readUserProtection' | 'updateUserProtection' | 'listMembers' | 'updateMember' | 'session' | 'overview' | 'listCategories' | 'updateCategory' | 'listPosts' | 'readPost' | 'listComments' | 'readComment' | 'listUsers' | 'listCases' | 'readCase' | 'closeCase' | 'listOperations' | 'listAudit'

function actionOf(value: unknown): Action | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const action = (value as Row).action
  if (action === 'readUserProtection' || action === 'updateUserProtection') return action
  if (action === 'listMembers' || action === 'updateMember') return action
  return action === 'session' || action === 'overview' || action === 'listCategories' || action === 'updateCategory' || action === 'listPosts' || action === 'readPost' || action === 'listComments'
    || action === 'readComment' || action === 'listUsers' || action === 'listCases' || action === 'readCase' || action === 'closeCase' || action === 'listOperations' || action === 'listAudit' ? action : null
}

function validWebUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
}

async function trustedWebUid(context: unknown): Promise<string | null> {
  try {
    // The identity SDK is deliberately loaded per request. Its context derives
    // only from the signed CloudBase invocation, never from browser data.
    const nodeSdk = require('@cloudbase/node-sdk') as typeof import('@cloudbase/node-sdk')
    const identity = await nodeSdk.init({ env: cloud.DYNAMIC_CURRENT_ENV }).auth().getAuthContext(context as never)
    if (!validWebUid(identity.uid) || String(identity.loginType).toUpperCase() === 'ANONYMOUS') return null
    return identity.uid
  } catch (_) {
    return null
  }
}

const authorizationStore: AdminAuthorizationStore = {
  async member(webUid) {
    const rows = (await db.collection('admin_members').where({ web_uid: webUid }).limit(2).get()).data
    if (rows.length > 1) throw Error('Duplicate admin member')
    if (rows.length === 0) return null
    const row = rows[0]!
    const accountId = text(row.account_id)
    const role = row.role
    const status = row.status
    const version = row.version
    if ((role !== 'owner' && role !== 'community' && role !== 'viewer') || (status !== 'active' && status !== 'revoked')
      || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw Error('Invalid admin member')
    const kind = row.kind === 'platform-owner' ? 'platform-owner' : row.kind === 'business' ? 'business' : null
    if (kind === null) throw Error('Invalid admin member kind')
    return { accountId, kind, role, status, version, webUid: text(row.web_uid) }
  },
  async account(accountId) {
    const user = (await db.collection('users').doc(accountId).get()).data
    if (user === null) return null
    const lifecycleRows = (await db.collection('account_lifecycle').where({ currentAccountId: accountId }).limit(2).get()).data
    if (lifecycleRows.length > 1) throw Error('Duplicate account lifecycle')
    const lifecycle = lifecycleRows[0]
    const state = lifecycle?.state
    if (state !== 'active' && state !== 'closing' && state !== 'closed') throw Error('Account lifecycle is not migrated')
    return { id: text(user._id), lifecycle: state, role: text(user.role), verified: user.verified === true }
  },
}

export async function main(event: unknown, context?: unknown) {
  const webUid = await trustedWebUid(context)
  if (webUid === null) return fail('后台身份验证失败', 'AUTH_FAILED')
  const action = actionOf(event)
  if (action === null) return fail('未知操作', 'UNKNOWN_ACTION')
  try {
    const principal = await authorizeAdmin(authorizationStore, webUid)
    switch (action) {
      case 'readUserProtection': {
        if (!hasAdminCapability(principal, 'users:read')) return fail('当前账号没有用户查看权限', 'FORBIDDEN')
        const id = (event as Row).accountId
        if (typeof id !== 'string' || !id || id.length > 128 || id.trim() !== id) return fail('账号参数无效', 'INVALID_INPUT')
        const row = (await db.collection('users').doc(id).get()).data
        if (!row) return fail('账号不存在', 'NOT_FOUND')
        return ok({ user: projectAdminUser(row), restrictions: parseAccountRestrictions(row.restrictions) })
      }
      case 'updateUserProtection': return ok(await applyAccountRestriction(db, webUid, event))
      case 'listMembers': {
        if (!hasAdminCapability(principal, 'settings:write')) return fail('当前账号没有成员管理权限', 'FORBIDDEN')
        const rows = (await db.collection('admin_members').orderBy('_id', 'asc').limit(101).get()).data
        return ok({ members: parseAdminMembers(rows.map(row => ({ ...row, id: text(row._id) }))) })
      }
      case 'updateMember': return ok(await applyMemberChange(db, webUid, event))
      case 'readComment': {
        if (!hasAdminCapability(principal, 'governance:write')) return fail('当前账号没有案件内容访问权限', 'FORBIDDEN')
        return ok(await readGovernanceComment({ read: async id => (await db.collection('comments').doc(id).get()).data, post: async id => (await db.collection('posts').doc(id).get()).data, identifier: stableDocumentId }, (event as Row).id))
      }
      case 'readCase': {
        if (!hasAdminCapability(principal, 'governance:write')) return fail('当前账号没有案件访问权限', 'FORBIDDEN')
        return ok(await readCaseDetail({ read: async id => (await db.collection('governance_cases').doc(id).get()).data }, event))
      }
      case 'closeCase': return ok(await applyCaseDecision(db, webUid, event))
      case 'listComments': {
        if (!hasAdminCapability(principal, 'content:read')) return fail('当前账号没有查看评论的权限', 'FORBIDDEN')
        return ok(await readAdminComments({
          post: async id => (await db.collection('posts').doc(id).get()).data,
          list: async (request, take) => {
            const conditions: object[] = [{ post_id: request.postId }]
            if (request.cursor) conditions.push(db.command.or([
              { created_at: db.command.gt(new Date(request.cursor.created_at)) },
              { created_at: new Date(request.cursor.created_at), _id: db.command.gt(request.cursor.id) },
            ]))
            return (await db.collection('comments').where(db.command.and(conditions)).orderBy('created_at', 'asc').orderBy('_id', 'asc').limit(take).get()).data
          },
        }, event))
      }
      case 'readPost': {
        if (!hasAdminCapability(principal, 'content:read')) return fail('当前账号没有查看内容的权限', 'FORBIDDEN')
        return ok(await readAdminPost({ read: async id => (await db.collection('posts').doc(id).get()).data }, event))
      }
      case 'updateCategory': return ok(await applyCategoryChange(db, webUid, event))
      case 'session': return ok({ accountId: principal.accountId, capabilities: principal.capabilities, memberVersion: principal.memberVersion, role: principal.role })
      case 'overview': {
        if (!hasAdminCapability(principal, 'content:read')) return fail('当前账号没有查看总览的权限', 'FORBIDDEN')
        return ok(await readAdminOverview({ now: () => new Date().toISOString(), count: async key => {
          switch (key) {
            case 'users': return (await db.collection('users').count()).total
            case 'verifiedUsers': return (await db.collection('users').where({ verified: true }).count()).total
            case 'posts': return (await db.collection('posts').where({ status: 'published' }).count()).total
            case 'openCases': return (await db.collection('governance_cases').where({ status: 'open' }).count()).total
          }
        } }, principal.capabilities))
      }
      case 'listCategories': {
        if (!hasAdminCapability(principal, 'content:read')) return fail('当前账号没有查看分类的权限', 'FORBIDDEN')
        const categories = await listAdminCategories({ listAll: async () => (await db.collection('categories').orderBy('sort_order', 'asc').orderBy('_id', 'asc').limit(101).get()).data })
        return ok(categories)
      }
      case 'listPosts': {
        if (!hasAdminCapability(principal, 'content:read')) return fail('当前账号没有查看内容的权限', 'FORBIDDEN')
        return ok(await readAdminPosts({ list: async (query, take) => {
          const conditions: object[] = [{ status: query.status }]
          if (query.query) conditions.push({ title: db.RegExp({ regexp: query.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) })
          if (query.cursor) conditions.push(db.command.or([
            { created_at: db.command.lt(new Date(query.cursor.createdAt)) },
            { created_at: new Date(query.cursor.createdAt), _id: db.command.lt(query.cursor.id) },
          ]))
          return (await db.collection('posts').where(db.command.and(conditions)).orderBy('created_at', 'desc').orderBy('_id', 'desc').limit(take)
            .field({ _id: true, title: true, category_id: true, anonymous: true, author: true, status: true, created_at: true, comment_count: true, revision: true }).get()).data
        } }, event))
      }
      case 'listUsers': {
        if (!hasAdminCapability(principal, 'users:read')) return fail('当前账号没有查看用户的权限', 'FORBIDDEN')
        return ok(await readAdminUsers({ list: async (query, take) => {
          const conditions: object[] = []
          if (query.verification !== 'all') conditions.push({ verified: query.verification === 'verified' })
          if (query.query) conditions.push({ nickname: db.RegExp({ regexp: query.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) })
          if (query.cursor) conditions.push(db.command.or([
            { created_at: db.command.lt(new Date(query.cursor.createdAt)) },
            { created_at: new Date(query.cursor.createdAt), _id: db.command.lt(query.cursor.id) },
          ]))
          return (await db.collection('users').where(conditions.length ? db.command.and(conditions) : {})
            .orderBy('created_at', 'desc').orderBy('_id', 'desc').limit(take)
            .field({ _id: true, nickname: true, email: true, verified: true, role: true, created_at: true }).get()).data
        } }, event))
      }
      case 'listCases': {
        if (!hasAdminCapability(principal, 'governance:write')) return fail('当前账号没有查看治理案件的权限', 'FORBIDDEN')
        const rows = await db.collection('governance_cases').orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(50).get()
        return ok({ cases: rows.data.map(projectAdminCase) })
      }
      case 'listOperations': {
        if (!hasAdminCapability(principal, 'operations:read')) return fail('当前账号没有查看运行状态的权限', 'FORBIDDEN')
        const [notifications, profiles] = await Promise.all([
          db.collection('notification_outbox').where({ status: 'pending' }).count(), db.collection('profile_outbox').where({ status: 'pending' }).count(),
        ])
        return ok({ pendingNotifications: notifications.total, pendingProfiles: profiles.total })
      }
      case 'listAudit': {
        if (!hasAdminCapability(principal, 'audit:read')) return fail('当前账号没有查看操作记录的权限', 'FORBIDDEN')
        const rows = await db.collection('audit_events').orderBy('at', 'desc').orderBy('_id', 'desc').limit(50).get()
        return ok({ events: rows.data.map(row => ({ id: text(row._id), action: text(row.action), at: row.at instanceof Date ? row.at.toISOString() : text(row.at), target: text(row.target ?? row.caseId) })) })
      }
    }
  } catch (error) {
    if (error instanceof AccountRestrictionFailure) return fail(error.message, error.code)
    if (error instanceof AdminMemberChangeFailure) return fail(error.message, error.code)
    if (error instanceof CommentGovernanceFailure) return fail('评论已变化或不存在，请刷新案件', error.code)
    if (error instanceof PostGovernanceFailure) return fail('帖子已变更或已不可下架，请刷新核对', error.code)
    if (error instanceof CaseManagementFailure) return fail('案件已变化或输入无效，请刷新后核对', error.code)
    if (error instanceof AdminCommentFailure) return fail('评论参数无效或所属帖子已不可读取', error.code)
    if (error instanceof AdminPostUnavailable) return fail('内容已删除或不存在', 'NOT_FOUND')
    if (error instanceof AdminPostInputFailure) return fail('内容筛选或翻页参数无效，请刷新列表', 'INVALID_INPUT')
    if (error instanceof CategoryChangeFailure) return fail('分类修改未完成，请检查输入或刷新当前版本', error.code)
    if (error instanceof AdminUserInputFailure) return fail('用户筛选或翻页参数无效，请刷新列表', 'INVALID_INPUT')
    if (error instanceof AdminAuthorizationFailure) {
      return fail({ AUTH_FAILED: '后台身份验证失败', AUTH_UNAVAILABLE: '后台身份服务暂时不可用', FORBIDDEN: '当前账号没有后台权限' }[error.code], error.code)
    }
    console.error('[admin] request failed')
    return fail('后台数据暂时无法读取，请重试', 'QUERY_ERROR')
  }
}
