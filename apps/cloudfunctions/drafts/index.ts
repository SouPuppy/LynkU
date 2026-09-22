// CloudBase adapter for the strict draft application.
import * as cloud from 'wx-server-sdk'
import { connectDatabase, CLOUD_DATABASE_OPTIONS, record, text } from '../common/database'
cloud.init()
const db = connectDatabase(cloud.database(CLOUD_DATABASE_OPTIONS))
import { ok, fail, stableDocumentId, checkRateLimit, authorizeAction, withAuth } from '../common'
import { saveUserDraft, listUserDrafts, deleteUserDraft, DraftFailure, type DraftStore } from '@lynku/server'

function draftRecord(value: unknown) {
  if (value === null) return null
  const row = record(value)
  return { ...row, created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at }
}

export const main = withAuth(cloud, async (openid, event) => {
  const authorization = await authorizeAction(db, openid, 'drafts', event.action)
  if (!authorization.allowed) return authorization.response
  let rateFailure: ReturnType<typeof fail> | null = null
  const store: DraftStore = {
    identifier: stableDocumentId,
    now: () => new Date().toISOString(),
    async authorizeSave() {
      const rate = await checkRateLimit(db, openid, 'drafts:save', { limit: 120, windowMs: 3600000 })
      if (!rate.allowed) {
        rateFailure = fail('暂时无法保存，请稍后重试', rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED')
        throw new Error('Save rate rejected')
      }
    },
    async list(owner, take) {
      return (await db.collection('drafts').where({ _openid: owner })
        .orderBy('updated_at', 'desc').orderBy('_id', 'desc').limit(take).get()).data.map(draftRecord)
    },
    run(operation) {
      return db.runTransaction(transaction => operation({
        async draft(id) { return draftRecord((await transaction.collection('drafts').doc(id).get()).data) },
        async counter(owner) { return (await transaction.collection('draft_counters').doc(stableDocumentId('draft:counter', owner)).get()).data },
        async putDraft(id, row) {
          const { _id, ...data } = row
          await transaction.collection('drafts').doc(id).set({ data: {
            ...data, created_at: new Date(text(data.created_at)), updated_at: new Date(text(data.updated_at)),
          } })
        },
        async putCounter(owner, count) {
          await transaction.collection('draft_counters').doc(stableDocumentId('draft:counter', owner))
            .set({ data: { _openid: owner, count, updated_at: db.serverDate() } })
        },
        async removeDraft(id) { await transaction.collection('drafts').doc(id).remove() },
      }))
    },
  }
  try {
    switch (event.action) {
      case 'save': return ok(await saveUserDraft(store, openid, event))
      case 'list': return ok({ drafts: await listUserDrafts(store, openid) })
      case 'delete': await deleteUserDraft(store, openid, event.draft_id, event.expected_revision); return ok({ deleted: true })
      default: return fail('未知操作', 'UNKNOWN_ACTION')
    }
  } catch (error) {
    if (rateFailure) return rateFailure
    if (error instanceof DraftFailure) return fail({ INVALID_INPUT: '草稿参数无效', NOT_FOUND: '草稿不存在',
      FORBIDDEN: '无权操作', DRAFT_CONFLICT: '草稿已更新，请保留当前内容并重新加载',
      CONFLICT: '相同请求ID不能用于不同内容', DRAFT_LIMIT_REACHED: '草稿已达上限（50个）' }[error.code], error.code)
    return fail('草稿操作失败，请稍后重试', event.action === 'save' ? 'SAVE_ERROR' : event.action === 'delete' ? 'DELETE_ERROR' : 'QUERY_ERROR')
  }
})
