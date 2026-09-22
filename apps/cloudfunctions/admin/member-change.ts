import { changeAdminMember, AdminAuthorizationFailure } from '@lynku/server'
import { parseAdminMember } from '@lynku/contracts'
import { prepareAdminWriteAuthorization } from './write-authorization'
import { record, text, type CloudDatabase } from '../common/database'
import { stableDocumentId } from '../common'

export async function applyMemberChange(db: CloudDatabase, webUid: string, input: unknown) {
  const bindings = (await db.collection('admin_members').where({ web_uid: webUid }).limit(2).get()).data
  if (bindings.length !== 1) throw new AdminAuthorizationFailure('FORBIDDEN')
  const actorId = text(bindings[0]!._id)
  const authorize = await prepareAdminWriteAuthorization(db, webUid, 'settings:write')
  return changeAdminMember({ run: work => db.runTransaction(async transaction => {
    let actor = ''
    return work({
      authorize: async () => {
        const principal = await authorize(transaction)
        const binding = (await transaction.collection('admin_members').doc(actorId).get()).data
        if (!binding || binding.web_uid !== webUid || binding.account_id !== principal.accountId || binding.role !== 'owner' || binding.status !== 'active') throw new AdminAuthorizationFailure('FORBIDDEN')
        actor = principal.accountId
        return actorId
      },
      receipt: async requestId => {
        const value = (await transaction.collection('admin_operation_receipts').doc(stableDocumentId('member-change', webUid, requestId)).get()).data
        if (!value) return null
        return { fingerprint: text(value.fingerprint), member: parseAdminMember(value.member) }
      },
      read: async id => {
        const row = (await transaction.collection('admin_members').doc(id).get()).data
        return row ? parseAdminMember({ ...row, id: text(row._id) }) : null
      },
      update: member => transaction.collection('admin_members').doc(member.id).update({ data: { role: member.role, status: member.status, version: member.version } }),
      record: async (requestId, fingerprint, member, reason) => {
        if (!actor) throw new AdminAuthorizationFailure('FORBIDDEN')
        const id = stableDocumentId('member-change', webUid, requestId), at = new Date()
        await transaction.collection('admin_operation_receipts').doc(id).set({ data: { fingerprint, member: record(member), actor, createdAt: at } })
        await transaction.collection('audit_events').doc(id).set({ data: { actor, action: 'admin.member.changed', target: member.id, reason, requestId, revision: member.version, result: 'applied', at } })
      },
    })
  }) }, input)
}
