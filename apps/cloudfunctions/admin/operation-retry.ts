import { scheduleOutboxRetry, AdminAuthorizationFailure, OutboxRetryFailure } from '@lynku/server'
import { parseOperationRetry, parseOperationRetryReceipt } from '@lynku/contracts'
import { prepareAdminWriteAuthorization } from './write-authorization'
import { record, text, type CloudDatabase } from '../common/database'
import { stableDocumentId } from '../common'
export async function applyOperationRetry(db: CloudDatabase, webUid: string, input: unknown) {
  let request
  try { request = parseOperationRetry(input) } catch { throw new OutboxRetryFailure('INVALID_INPUT') }
  const authorize = await prepareAdminWriteAuthorization(db, webUid, 'operations:retry')
  const collection = request.kind === 'notifications' ? 'notification_outbox' : 'profile_outbox'
  const initial = (await db.collection(collection).doc(request.id).get()).data
  const notification = initial && request.kind === 'notifications' ? record(initial.notification) : null
  const sourceOpenid = initial ? text(notification ? notification.to : initial.openid) : null
  const users = sourceOpenid ? (await db.collection('users').where({ _openid: sourceOpenid }).limit(2).get()).data : []
  const userId = users.length === 1 ? text(users[0]!._id) : null
  const lifecycleRows = userId ? (await db.collection('account_lifecycle').where({ currentAccountId: userId }).limit(2).get()).data : []
  if (lifecycleRows.length > 1) throw Error('Duplicate lifecycle')
  const lifecycleId = lifecycleRows[0] ? text(lifecycleRows[0]._id) : null
  return scheduleOutboxRetry({ now: Date.now, run: work => db.runTransaction(async tx => {
    let actor = ''
    return work({
      authorize: async () => { actor = (await authorize(tx)).accountId },
      receipt: async requestId => {
        const previous = (await tx.collection('admin_operation_receipts').doc(stableDocumentId('outbox-retry', webUid, requestId)).get()).data
        return previous ? { fingerprint: text(previous.fingerprint), result: parseOperationRetryReceipt(previous.result) } : null
      },
      read: async (_kind, id) => (await tx.collection(collection).doc(id).get()).data,
      sourceValid: async (kind, task) => {
        if (!userId || !sourceOpenid) return false
        const user = (await tx.collection('users').doc(userId).get()).data
        if (!user || user._openid !== sourceOpenid) return false
        if (lifecycleId) {
          const lifecycle = (await tx.collection('account_lifecycle').doc(lifecycleId).get()).data
          if (!lifecycle || lifecycle.currentAccountId !== userId || lifecycle.state !== 'active') return false
        }
        if (kind === 'profiles') return task.openid === sourceOpenid && typeof task.profile_version === 'number' && typeof user.profile_version === 'number' && user.profile_version >= task.profile_version
        const current = record(task.notification), target = record(current.target), actor = record(current.actor)
        if (current.to !== sourceOpenid) return false
        const post = (await tx.collection('posts').doc(text(target.post_id)).get()).data
        const comment = (await tx.collection('comments').doc(text(target.comment_id)).get()).data
        if (!post || !comment || post.status !== 'published' || comment.status !== 'published'
          || comment.post_id !== post._id || comment._openid !== actor._openid || comment.anonymous !== current.anonymous) return false
        if (current.type === 'comment') return post._openid === sourceOpenid
        if (current.type !== 'reply' || typeof comment.parent_id !== 'string') return false
        const parent = (await tx.collection('comments').doc(comment.parent_id).get()).data
        return !!parent && parent.post_id === post._id && parent._openid === sourceOpenid
      },
      update: (_kind, id, fields) => tx.collection(collection).doc(id).update({ data: fields }),
      record: async (requestId, fingerprint, result, reason) => {
        if (!actor) throw new AdminAuthorizationFailure('FORBIDDEN')
        const id = stableDocumentId('outbox-retry', webUid, requestId), at = new Date(result.scheduledAt)
        await tx.collection('admin_operation_receipts').doc(id).set({ data: { fingerprint, result: record(result), actor, createdAt: at } })
        await tx.collection('audit_events').doc(id).set({ data: { actor, action: 'operation.retry.scheduled', target: `${result.kind}:${result.id}`, reason, requestId, revision: result.retryRevision, result: 'scheduled', at } })
      },
    })
  }) }, request)
}
