import { closeCase, hideReportedPost, removeReportedComment, nextPostCommentCount, AdminAuthorizationFailure } from '@lynku/server'
import { parseCaseDetail } from '@lynku/contracts'
import { prepareAdminWriteAuthorization } from './write-authorization'
import { record, text, type CloudDatabase } from '../common/database'
import { stableDocumentId } from '../common'
export async function applyCaseDecision(db: CloudDatabase, webUid: string, input: unknown) {
  const authorize = await prepareAdminWriteAuthorization(db, webUid, 'governance:write')
  return closeCase({ now: () => new Date().toISOString(), run: work => db.runTransaction(async tx => {
    let actor: string | null = null
    return work({
      authorize: async () => { actor = (await authorize(tx)).accountId },
      read: async id => (await tx.collection('governance_cases').doc(id).get()).data,
      removeComment: (id, token, caseId, at) => removeReportedComment({
        read: async id => (await tx.collection('comments').doc(id).get()).data,
        post: async id => (await tx.collection('posts').doc(id).get()).data,
        identifier: stableDocumentId,
        counter: async postId => (await tx.collection('comment_counters').doc(postId).get()).data,
        decrementPost: async postId => {
          const post = (await tx.collection('posts').doc(postId).get()).data
          if (!post || post._id !== postId) throw Error('Missing comment parent')
          await tx.collection('posts').doc(postId).update({ data: { comment_count: nextPostCommentCount(post.comment_count, -1) } })
        },
        remove: (id, caseId, at) => tx.collection('comments').doc(id).update({ data: { status: 'deleted', content: '', author: {}, governance_case_id: caseId, updated_at: new Date(at) } }),
        append: async (postId, commentId, sequence, at) => {
          await tx.collection('comment_counters').doc(postId).set({ data: { post_id: postId, sequence, updated_at: new Date(at) } })
          await tx.collection('comment_changes').doc(stableDocumentId('comment:change', postId, String(sequence))).set({ data: { post_id: postId, sequence, comment_id: commentId, type: 'deleted', created_at: new Date(at) } })
        },
      }, id, token, caseId, at),
      hidePost: (id, expectedRevision, caseId, at) => hideReportedPost({
        post: async id => (await tx.collection('posts').doc(id).get()).data,
        category: async id => (await tx.collection('categories').doc(id).get()).data,
        updatePost: (id, fields) => tx.collection('posts').doc(id).update({ data: { ...fields, updated_at: new Date(fields.updated_at) } }),
        setCategoryCount: (id, post_count) => tx.collection('categories').doc(id).update({ data: { post_count } }),
      }, id, expectedRevision, caseId, at),
      receipt: async requestId => {
        const value = (await tx.collection('admin_operation_receipts').doc(stableDocumentId('case-decision', webUid, requestId)).get()).data
        if (!value) return null
        return { fingerprint: text(value.fingerprint), result: parseCaseDetail(record(value.result)) }
      },
      update: (id, fields) => tx.collection('governance_cases').doc(id).update({ data: fields }),
      record: async (requestId, fingerprint, result, at) => {
        if (!actor) throw new AdminAuthorizationFailure('FORBIDDEN')
        const id = stableDocumentId('case-decision', webUid, requestId)
        await tx.collection('admin_operation_receipts').doc(id).set({ data: { actor, fingerprint, result, createdAt: new Date(at) } })
        await tx.collection('audit_events').doc(id).set({ data: { actor, action: 'governance.case.closed', target: result.id, reason: result.resolution, revision: result.version, outcome: result.outcome, at: new Date(at), requestId } })
      },
    })
  }) }, input)
}
