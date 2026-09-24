import type { PublicMessage } from '../../generated/contracts/index'
import type { SendOperation } from './send-operations'

type TimelineMessage = Pick<PublicMessage, '_id' | 'msg_id' | 'from' | 'content' | 'status'> & { created_at: string | Date; sync_sequence?: number }

export interface ChatMessageView {
  key: string
  messageId: string
  operationId: string
  content: string
  mine: boolean
  time: string
  status: string
  tone: 'normal' | 'pending' | 'error'
  action: 'retry' | 'edit' | 'discard' | 'none'
}

function messageTime(value: string | Date, now: number): string {
  const date = new Date(value), today = new Date(now)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.toDateString() === today.toDateString()) return time
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${date.getFullYear() === today.getFullYear() ? '' : `${date.getFullYear()}-`}${day} ${time}`
}

/** Keep provisional rows beside later local submissions, without reordering server history. */
export class ChatTimeline {
  private submitted = new Map<string, number>()
  private nextOrder = 0

  clear(): void { this.submitted.clear(); this.nextOrder = 0 }

  render(messages: readonly TimelineMessage[], pending: readonly SendOperation[], owner: string, now: number): ChatMessageView[] {
    for (const item of [...pending].sort((a, b) => a.order - b.order)) {
      if (!this.submitted.has(item.id)) this.submitted.set(item.id, ++this.nextOrder)
    }
    const confirmed = [...messages].sort((a, b) => (a.sync_sequence || 0) - (b.sync_sequence || 0))
    const known = new Set(confirmed.filter(item => item.from === owner).map(item => item.msg_id))
    const unresolved = pending.filter(item => !known.has(item.id))
      .sort((a, b) => this.submitted.get(a.id)! - this.submitted.get(b.id)!)
    const rows: ChatMessageView[] = confirmed.map(message => ({
      key: message.from === owner ? `out-${message.msg_id}` : `in-${message._id}`,
      messageId: message._id, operationId: '', content: message.content, mine: message.from === owner,
      time: messageTime(message.created_at, now),
      status: message.from === owner ? ({ sent: '已发送', delivered: '已送达', read: '已读' })[message.status] : '',
      tone: 'normal', action: 'none',
    }))
    for (const item of unresolved) {
      const order = this.submitted.get(item.id)!
      const next = confirmed.find(message => message.from === owner && (this.submitted.get(message.msg_id) || 0) > order)
      const anchor = next ? rows.findIndex(row => row.messageId === next._id) : -1
      const row: ChatMessageView = {
        key: `out-${item.id}`, messageId: '', operationId: item.id, content: item.text, mine: true,
        time: messageTime(new Date(item.submittedAt), now),
        status: item.state === 'sending' ? '正在发送…' : item.state === 'checking' ? '正在确认…' : item.error,
        tone: item.state === 'failed' ? 'error' : 'pending',
        action: item.state === 'failed' && item.action === 'none' ? 'discard' : item.action,
      }
      if (anchor < 0) rows.push(row)
      else rows.splice(anchor, 0, row)
    }
    // Once every local submission is settled, server sequence owns the whole timeline.
    if (pending.length === 0) this.clear()
    return rows
  }
}
