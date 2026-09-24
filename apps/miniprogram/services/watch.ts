import * as session from './session'
// services/watch.ts - Privacy-safe polling through cloud functions
import type { IPost, IMessage, IAnonymousChatTarget, IMessageSyncCursor } from '../typings/cloudbase'
import { listPosts } from './posts'
import { syncConversation, getReadReceipts } from './messages'
import { READ_BATCH_SIZE } from '../generated/contracts/index'

export interface WatcherHandle {
  close: () => void
}

type ChangeCallback<T> = (docs: T[], changes: { type: string; doc: T }[]) => void
type ErrorCallback = (err: Error) => void

const CONTENT_POLL_INTERVAL = 6000
const MESSAGE_POLL_INTERVAL = 4000

function diffDocuments<T extends { _id: string }>(previous: T[], current: T[]) {
  const previousById = new Map(previous.map(document => [document._id, document]))
  const currentById = new Map(current.map(document => [document._id, document]))
  const changes: { type: string; doc: T }[] = []

  for (const document of current) {
    const oldDocument = previousById.get(document._id)
    if (!oldDocument) changes.push({ type: 'add', doc: document })
    else if (JSON.stringify(oldDocument) !== JSON.stringify(document)) {
      changes.push({ type: 'update', doc: document })
    }
  }
  for (const document of previous) {
    if (!currentById.has(document._id)) changes.push({ type: 'remove', doc: document })
  }
  return changes
}

function startDocumentPoll<T extends { _id: string }>(
  fetchDocuments: () => Promise<T[]>,
  onChange: ChangeCallback<T>,
  onError: ErrorCallback,
): WatcherHandle {
  let previous: T[] | null = null
  let stopped = false
  let running = false

  const poll = async () => {
    if (stopped || running) return
    running = true
    try {
      const current = await fetchDocuments()
      if (stopped) return
      if (previous) {
        const changes = diffDocuments(previous, current)
        if (changes.length > 0) onChange(current, changes)
      }
      previous = current
    } catch (error) {
      onError(error instanceof Error ? error : new Error('poll error'))
    } finally {
      running = false
    }
  }

  void poll()
  const timer = setInterval(poll, CONTENT_POLL_INTERVAL)
  return {
    close: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}

export function watchPosts(
  categoryId: string | undefined,
  onChange: ChangeCallback<IPost>,
  onError: ErrorCallback,
): WatcherHandle {
  return startDocumentPoll(
    async () => (await listPosts({ categoryId, limit: 50 })).items,
    onChange,
    onError,
  )
}

export interface MessagePoller {
  stop: () => void
}

export function pollMessages(
  peerOpenid: string | undefined,
  initialCursor: IMessageSyncCursor,
  onChanges: (messages: IMessage[]) => void,
  onError: ErrorCallback,
  target?: IAnonymousChatTarget | null,
  receipts?: { pending: () => string[]; apply: (readIds: string[]) => void; healthy?: (cursor: IMessageSyncCursor) => void },
): MessagePoller {
  const owner = session.getOpenid()
  let cursor = initialCursor
  let stopped = false
  let running = false
  let receiptOffset = 0

  const poll = async () => {
    if (stopped || running || session.getState() !== 'verified' || session.getOpenid() !== owner) return
    running = true
    try {
      const changedById = new Map<string, IMessage>()
      let pendingCursor = cursor
      let hasMore = true
      let pages = 0
      while (hasMore && pages < 5) {
        const result = await syncConversation(peerOpenid, pendingCursor, 50, target)
        if (stopped || session.getState() !== 'verified' || session.getOpenid() !== owner) return
        for (const message of result.messages) changedById.set(message._id, message)
        const nextCursor = result.nextCursor
        hasMore = result.hasMore
        pendingCursor = nextCursor
        pages += 1
      }
      if (changedById.size > 0) onChanges(Array.from(changedById.values()))
      cursor = pendingCursor
      if (receipts) {
        const pending = [...new Set(receipts.pending())]
        if (pending.length > 0) {
          receiptOffset %= pending.length
          const ids = [...pending.slice(receiptOffset), ...pending.slice(0, receiptOffset)].slice(0, READ_BATCH_SIZE)
          const readIds = await getReadReceipts(peerOpenid, ids, target)
          if (stopped || session.getState() !== 'verified' || session.getOpenid() !== owner) return
          receipts.apply(readIds)
          receiptOffset = (receiptOffset + ids.length) % pending.length
        }
      }
      receipts?.healthy?.(cursor)
    } catch (error) {
      if (!stopped && session.getState() === 'verified' && session.getOpenid() === owner) {
        onError(error instanceof Error ? error : new Error('poll error'))
      }
    } finally {
      running = false
    }
  }

  const timer = setInterval(poll, MESSAGE_POLL_INTERVAL)
  if (receipts?.healthy) void poll()
  const stop = () => {
    stopped = true
    clearInterval(timer)
    unsubscribe()
  }
  const unsubscribe = session.onChange(() => {
    if (session.getState() !== 'verified' || session.getOpenid() !== owner) stop()
  })
  return { stop }
}
