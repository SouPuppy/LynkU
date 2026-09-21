import type { TargetStore, ConversationDirectoryStore, MessageHistoryStore, MessageSyncStore,
  ReadReceiptStore, MessageSendStore, ReadTransactionStore, NotificationStore } from '@lucky/server'
import { documentData, queryData, queryCount, updatedCount, type MessagingDatabase } from './messaging-database'

export interface MessagingAdapterDependencies {
  identifier(...parts: string[]): string
  authorizeSendRate(owner: string): Promise<void>
}

export class MessageRecipientUnavailable extends Error {}

/** CloudBase persistence only; the caller supplies identity, policy, and use cases. */
export function createCloudBaseMessagingAdapters(db: MessagingDatabase, dependencies: MessagingAdapterDependencies) {
  const command = db.command
  const entryId = (owner: string, conversation: string) => dependencies.identifier('conversation_entry', owner, conversation)

  const targetStore: TargetStore = {
    identifier: dependencies.identifier,
    async source(type, id) {
      return documentData(await db.collection(type === 'post' ? 'posts' : 'comments').doc(id).get())
    },
    async directory(owner, conversation) {
      return documentData(await db.collection('conversation_entries').doc(entryId(owner, conversation)).get())
    },
  }

  const directoryStore: ConversationDirectoryStore = {
    async list(owner, cursor, take) {
      const condition = cursor ? command.and([
        { owner_openid: owner },
        command.or([
          { updated_at: command.lt(new Date(cursor.updatedAt)) },
          { updated_at: new Date(cursor.updatedAt), _id: command.lt(cursor.id) },
        ]),
      ]) : { owner_openid: owner }
      return queryData(await db.collection('conversation_entries').where(condition)
        .orderBy('updated_at', 'desc').orderBy('_id', 'desc').limit(take).get())
    },
    async profiles(owners) {
      return queryData(await db.collection('users').where({ _openid: command.in(owners) })
        .field({ _openid: true, nickname: true, avatar_url: true }).get())
    },
  }

  const historyStore: MessageHistoryStore = {
    async list(conversation, before, take) {
      const condition: Record<string, unknown> = { conversation_id: conversation }
      if (before !== undefined) condition.sync_sequence = command.lt(before)
      return queryData(await db.collection('messages').where(condition)
        .orderBy('sync_sequence', 'desc').limit(take).get())
    },
  }

  const messageSyncStore: MessageSyncStore = {
    async list(conversation, after, take) {
      return queryData(await db.collection('messages').where({
        conversation_id: conversation, sync_sequence: command.gt(after),
      }).orderBy('sync_sequence', 'asc').limit(take).get())
    },
  }

  const readReceiptStore: ReadReceiptStore = {
    async list(conversation, sender, ids) {
      return queryData(await db.collection('messages').where({
        conversation_id: conversation, from: sender, status: 'read', _id: command.in(ids),
      }).limit(ids.length).get())
    },
  }

  function createSendStore(conversation: string, owner: string, peer: string): MessageSendStore {
    return {
      async existing(id) { return documentData(await db.collection('messages').doc(id).get()) },
      async authorizeRecipientAndRate() {
        const recipients = queryData(await db.collection('users').where({ _openid: peer }).limit(1).get())
        if (!recipients.length) throw new MessageRecipientUnavailable('Recipient unavailable')
        const recipient = recipients[0]
        if (recipients.length !== 1 || !recipient || typeof recipient !== 'object' || Array.isArray(recipient)
          || !('_openid' in recipient) || recipient._openid !== peer) throw new Error('Invalid recipient query result')
        await dependencies.authorizeSendRate(owner)
      },
      identifier: dependencies.identifier,
      timestamp: () => db.serverDate(),
      run(documentId, operation) {
        return db.runTransaction(transaction => operation({
          async existing() { return documentData(await transaction.collection('messages').doc(documentId).get()) },
          async counter() { return documentData(await transaction.collection('conversation_counters').doc(conversation).get()) },
          async directory(member) {
            return documentData(await transaction.collection('conversation_entries').doc(entryId(member, conversation)).get())
          },
          async writeCounter(sequence) {
            await transaction.collection('conversation_counters').doc(conversation)
              .set({ data: { last_sequence: sequence, updated_at: db.serverDate() } })
          },
          async writeMessage(message) {
            const { _id, ...data } = message
            if (typeof _id !== 'string' || _id !== documentId) throw new Error('Message write ID mismatch')
            await transaction.collection('messages').doc(_id).set({ data })
          },
          async writeDirectory(member, entry) {
            await transaction.collection('conversation_entries').doc(entryId(member, conversation)).set({ data: entry })
          },
        }))
      },
    }
  }

  function createReadStore(conversation: string, owner: string): ReadTransactionStore {
    const directoryId = entryId(owner, conversation)
    return {
      run(operation) {
        return db.runTransaction(transaction => operation({
          async message(id) { return documentData(await transaction.collection('messages').doc(id).get()) },
          async directory() { return documentData(await transaction.collection('conversation_entries').doc(directoryId).get()) },
          async setMessageRead(id) {
            await transaction.collection('messages').doc(id).update({ data: { status: 'read', updated_at: db.serverDate() } })
          },
          async setDirectoryUnread(count, lastMessageRead) {
            const data: Record<string, unknown> = { unread_count: count }
            if (lastMessageRead) data['last_message.status'] = 'read'
            await transaction.collection('conversation_entries').doc(directoryId).update({ data })
          },
        }))
      },
    }
  }

  const notificationStore: NotificationStore = {
    identifier: dependencies.identifier,
    async list(owner, unreadOnly, cursor, take) {
      const ownerCondition = unreadOnly ? { to: owner, read: false } : { to: owner }
      const condition = cursor ? command.and([ownerCondition, command.or([
        { created_at: command.lt(new Date(cursor.createdAt)) },
        { created_at: new Date(cursor.createdAt), _id: command.lt(cursor.id) },
      ])]) : ownerCondition
      return queryData(await db.collection('notifications').where(condition)
        .orderBy('created_at', 'desc').orderBy('_id', 'desc').limit(take).get())
    },
    async markRead(owner, ids) {
      return updatedCount(await db.collection('notifications').where({ to: owner, read: false, _id: command.in(ids) })
        .update({ data: { read: true } }))
    },
    async unreadCount(owner) {
      return queryCount(await db.collection('notifications').where({ to: owner, read: false }).count())
    },
  }

  async function unreadMessageCount(owner: string): Promise<number> {
    return queryCount(await db.collection('messages').where({ to: owner, status: command.neq('read') }).count())
  }

  return { targetStore, directoryStore, historyStore, messageSyncStore, readReceiptStore,
    createSendStore, createReadStore, notificationStore, unreadMessageCount }
}
