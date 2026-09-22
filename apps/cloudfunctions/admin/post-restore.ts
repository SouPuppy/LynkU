import * as cloud from 'wx-server-sdk'
import { restoreGovernedPost, RestoreGovernedPostFailure, ModerationFailure } from '@lynku/server'
import { parseRestoreGovernedPostReceipt, parseRestoreGovernedPostRequest, type RestoreGovernedPostReceipt } from '@lynku/contracts'
import { wechatTextSafety } from '@lynku/adapters'
import { prepareAdminWriteAuthorization } from './write-authorization'
import { record, text, type CloudDatabase } from '../common/database'
import { stableDocumentId } from '../common'

function storedReceipt(value: unknown): { fingerprint: string; result: RestoreGovernedPostReceipt } | null {
  if (!value) return null
  const row = record(value)
  return { fingerprint: text(row.fingerprint), result: parseRestoreGovernedPostReceipt(row.result) }
}

/** Admin restoration is a governance operation, not an alternative publication API. */
export async function applyPostRestoration(db: CloudDatabase, webUid: string, input: unknown) {
  let request
  try { request = parseRestoreGovernedPostRequest(input) } catch { throw new RestoreGovernedPostFailure('INVALID_INPUT') }
  const authorize = await prepareAdminWriteAuthorization(db, webUid, 'governance:write')
  const receiptId = (requestId: string) => stableDocumentId('post-restoration', webUid, requestId)
  return restoreGovernedPost({
    now: () => new Date().toISOString(),
    inspect: async id => (await db.collection('posts').doc(id).get()).data,
    prior: async requestId => storedReceipt((await db.collection('admin_operation_receipts').doc(receiptId(requestId)).get()).data),
    moderate: async (openid, content) => wechatTextSafety(input => cloud.openapi.security.msgSecCheck(input), openid, 3)(content),
    run: work => db.runTransaction(async transaction => {
      let actor = ''
      return work({
        authorize: async () => { actor = (await authorize(transaction)).accountId },
        post: async id => (await transaction.collection('posts').doc(id).get()).data,
        category: async id => (await transaction.collection('categories').doc(id).get()).data,
        case: async id => (await transaction.collection('governance_cases').doc(id).get()).data,
        receipt: async requestId => storedReceipt((await transaction.collection('admin_operation_receipts').doc(receiptId(requestId)).get()).data),
        updatePost: (id, fields) => transaction.collection('posts').doc(id).update({ data: { ...fields, updated_at: new Date(fields.updated_at) } }),
        setCategoryCount: (id, count) => transaction.collection('categories').doc(id).update({ data: { post_count: count } }),
        record: async (requestId, fingerprint, result, reason) => {
          if (!actor) throw Error('Missing trusted operator')
          const id = receiptId(requestId), at = new Date(result.appliedAt)
          await transaction.collection('admin_operation_receipts').doc(id).set({ data: { actor, fingerprint, result: record(result), createdAt: at } })
          await transaction.collection('audit_events').doc(id).set({ data: { actor, action: 'governance.post.restored', target: result.post.id,
            caseId: request.caseId, reason, requestId, revision: result.post.revision, result: 'restored', at } })
        },
      })
    }),
  }, input)
}

export function postRestorationFailure(error: unknown): { code: string; message: string } | null {
  if (error instanceof RestoreGovernedPostFailure) return { code: error.code, message: '帖子、案件或分类状态已变化，请刷新后重新核对' }
  if (error instanceof ModerationFailure) return { code: error.code, message: error.code === 'CONTENT_REJECTED' ? '当前正文未通过自动安全检查，不能恢复' : '自动安全检查暂不可用，不能恢复' }
  return null
}
