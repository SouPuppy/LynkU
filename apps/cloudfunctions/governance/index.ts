import * as cloud from 'wx-server-sdk'
import { appealOwnReport } from '@lynku/server'
import { submitReport, ReportFailure, type ReportTarget, type ReportStore } from '@lynku/server'
import { readOwnReport, CaseManagementFailure } from '@lynku/server'
import { listOwnReports } from '@lynku/server'
import { connectDatabase, CLOUD_DATABASE_OPTIONS, text, type Row } from '../common/database'
import { authorizeAction, fail, ok, stableDocumentId, withAuth } from '../common'

cloud.init()
const db = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))

export const main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'governance', event.action)
  if (!authorization.allowed) return authorization.response
  switch (event.action) {
    case 'appealReport': {
      if (!authorization.user) return fail('身份验证失败', 'AUTH_FAILED')
      const accountId = text(authorization.user._id)
      try { return ok(await appealOwnReport({ now: () => new Date().toISOString(), identifier: stableDocumentId,
        run: work => db.runTransaction(tx => work({
          authorize: async () => { const user = (await tx.collection('users').doc(accountId).get()).data; if (!user || user._openid !== openid) throw new CaseManagementFailure('FORBIDDEN') },
          read: async id => (await tx.collection('governance_cases').doc(id).get()).data,
          update: (id, fields) => tx.collection('governance_cases').doc(id).update({ data: fields }),
          audit: (id, fields) => tx.collection('audit_events').doc(id).set({ data: { ...fields, at: new Date(text(fields.at)) } }),
        })),
      }, accountId, event)) }
      catch (error) { return fail(error instanceof CaseManagementFailure && error.code === 'CONFLICT' ? '记录已变化或已提交过申诉，请刷新查看' : '申诉暂未完成，请稍后重试', error instanceof CaseManagementFailure ? error.code : 'SAVE_ERROR') }
    }
    case 'listReports': {
      if (!authorization.user) return fail('身份验证失败', 'AUTH_FAILED')
      try { return ok(await listOwnReports({ identifier: stableDocumentId, list: async (accountId, request, take) => {
        const conditions: object[] = [{ reporterAccountId: accountId }]
        if (request.cursor) conditions.push(db.command.or([{ createdAt: db.command.lt(request.cursor.createdAt) }, { createdAt: request.cursor.createdAt, _id: db.command.lt(request.cursor.id) }]))
        return (await db.collection('governance_cases').where(db.command.and(conditions)).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(take).get()).data
      } }, text(authorization.user._id), event)) }
      catch (error) { return fail('举报记录暂时无法读取', error instanceof CaseManagementFailure ? error.code : 'QUERY_ERROR') }
    }
    case 'readReport': {
      if (!authorization.user) return fail('身份验证失败', 'AUTH_FAILED')
      try { return ok(await readOwnReport({ read: async id => (await db.collection('governance_cases').doc(id).get()).data }, text(authorization.user._id), event)) }
      catch (error) { return fail('举报结果暂时无法读取', error instanceof CaseManagementFailure ? error.code : 'QUERY_ERROR') }
    }
    case 'submitReport': return report(authorization.user, event)
    default: return fail('未知操作', 'UNKNOWN_ACTION')
  }
})

async function report(principal: Row | undefined, event: unknown) {
  if (!principal) return fail('身份服务暂时不可用', 'AUTH_UNAVAILABLE')
  const reporterAccountId = text(principal._id)
  const store: ReportStore = {
    identifier: stableDocumentId,
    now: () => new Date().toISOString(),
    async target(target: ReportTarget) {
      const row = (await db.collection(target.type === 'post' ? 'posts' : 'comments').doc(target.id).get()).data
      if (row === null || row.status !== 'published') return null
      return row
    },
    existing: async id => (await db.collection('governance_cases').doc(id).get()).data,
    run: work => db.runTransaction(transaction => work({
      existing: async id => (await transaction.collection('governance_cases').doc(id).get()).data,
      put: async (id, row) => { const { _id, ...data } = row; await transaction.collection('governance_cases').doc(id).set({ data }) },
      audit: async (id, row) => { const { _id, ...data } = row; await transaction.collection('audit_events').doc(id).set({ data }) },
    })),
  }
  try { return ok(await submitReport(store, reporterAccountId, event)) } catch (error) {
    if (error instanceof ReportFailure) return fail({ INVALID_INPUT: '举报内容无效', NOT_FOUND: '举报目标当前不可用', CONFLICT: '该请求已用于其他举报' }[error.code], error.code)
    console.error('[governance] report intake failed:', error instanceof Error ? error.message : error)
    return fail('举报暂未受理，请稍后重试', 'SAVE_ERROR')
  }
}
