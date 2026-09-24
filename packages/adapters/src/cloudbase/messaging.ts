import type { TargetStore, ConversationDirectoryStore, MessageHistoryStore, MessageSyncStore,
  ReadReceiptStore, MessageSendStore, ReadTransactionStore, NotificationStore, AnonymousConversationContext } from '@lynku/server'
import { assertAccountCapability, AccountRestrictionFailure } from '@lynku/server'
import { documentData, queryData, queryCount, updatedCount, type MessagingDatabase } from './messaging-database'

export interface MessagingAdapterDependencies {
  identifier(...parts: string[]): string
  moderate(content: string): Promise<{ clean: boolean }>
  assertCanSend(owner: string, peer: string): Promise<void>
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
      if (type === 'user') {
        const rows = queryData(await db.collection('users').where({ _openid: id }).limit(2).get())
        return rows.length === 1 ? rows[0] : null
      }
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
    async firstUnread(conversation, viewer) {
      const rows = queryData(await db.collection('messages').where({ conversation_id: conversation, to: viewer, status: command.neq('read') })
        .orderBy('sync_sequence', 'asc').limit(1).get())
      return rows[0] ?? null
    },
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

  function createSendStore(conversation: string, owner: string, peer: string, context?: AnonymousConversationContext | null): MessageSendStore {
    return {
      async existing(id) { return documentData(await db.collection('messages').doc(id).get()) },
      moderate: dependencies.moderate,
      async authorizeRecipientAndRate() {
        const recipients = queryData(await db.collection('users').where({ _openid: peer }).limit(1).get())
        if (!recipients.length) throw new MessageRecipientUnavailable('Recipient unavailable')
        const recipient = recipients[0]
        if (recipients.length !== 1 || !recipient || typeof recipient !== 'object' || Array.isArray(recipient)
          || !('_openid' in recipient) || recipient._openid !== peer) throw new Error('Invalid recipient query result')
        await dependencies.assertCanSend(owner, peer)
        await dependencies.authorizeSendRate(owner)
      },
      identifier: dependencies.identifier,
      timestamp: () => db.serverDate(),
      async run(documentId, operation) {
        const accounts = queryData(await db.collection('users').where({ _openid: owner }).limit(2).get())
        const initial = accounts[0] as Record<string, unknown> | undefined
        if (accounts.length !== 1 || !initial || typeof initial._id !== 'string') throw new AccountRestrictionFailure('FORBIDDEN', '发送账号不可用')
        const accountId = initial._id
        return db.runTransaction(async transaction => {
          const account = documentData(await transaction.collection('users').doc(accountId).get()) as Record<string, unknown> | null
          if (!account || account._openid !== owner || account.verified !== true) throw new AccountRestrictionFailure('FORBIDDEN', '发送账号资格已变化')
          assertAccountCapability(account, 'messages', new Date().toISOString())
          if (context && !documentData(await transaction.collection('conversation_counters').doc(conversation).get()) && context.source_type !== 'user') {
            const source = documentData(await transaction.collection(context.source_type === 'post' ? 'posts' : 'comments').doc(context.source_id).get()) as Record<string, unknown> | null
            if (!source || source.status !== 'published' || source._openid !== context.target_openid
              || (source.anonymous === true ? 'anonymous' : 'real') !== context.target_visibility) throw new AccountRestrictionFailure('FORBIDDEN', '来源内容已变化，请重新进入对话')
            if (context.source_type === 'comment') {
              if (typeof source.post_id !== 'string') throw new Error('Invalid comment source')
              const post = documentData(await transaction.collection('posts').doc(source.post_id).get()) as Record<string, unknown> | null
              if (post?.status !== 'published') throw new AccountRestrictionFailure('FORBIDDEN', '来源内容已不可用')
            }
          }
          const blockId = dependencies.identifier('messaging:block', ...[owner, peer].sort())
          const block = documentData(await transaction.collection('messaging_blocks').doc(blockId).get()) as Record<string, unknown> | null
          if (block && (!Array.isArray(block.blockedBy) || block.blockedBy.length > 0)) {
            throw new AccountRestrictionFailure('FORBIDDEN', '当前无法发送给该用户')
          }
          return operation({
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
          })
        })
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
    async contentSources(postIds, commentIds) {
      const [posts, comments] = await Promise.all([
        postIds.length ? Promise.resolve(db.collection('posts').where({ _id: command.in(postIds) }).limit(postIds.length).get()).then(queryData) : [],
        commentIds.length ? Promise.resolve(db.collection('comments').where({ _id: command.in(commentIds) }).limit(commentIds.length).get()).then(queryData) : [],
      ])
      return { posts, comments }
    },
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
