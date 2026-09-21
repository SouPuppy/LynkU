import type { IMessage } from '../typings/cloudbase'

/** Read receipts are monotonic even when older send/history responses arrive later. */
export function mergeChatMessages(existing: IMessage[], incoming: IMessage[]): IMessage[] {
  const messages = new Map(existing.map(message => [message._id, message]))
  const rank = { sent: 0, delivered: 1, read: 2 }
  for (const message of incoming) {
    const previous = messages.get(message._id)
    messages.set(message._id, previous && rank[previous.status] > rank[message.status]
      ? { ...message, status: previous.status } : message)
  }
  return [...messages.values()].sort((a, b) => (a.sync_sequence || 0) - (b.sync_sequence || 0))
}
