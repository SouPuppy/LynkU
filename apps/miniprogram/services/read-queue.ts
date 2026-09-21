import type { IAnonymousChatTarget } from '../typings/cloudbase'
import { READ_BATCH_SIZE, parseReadMessageIds } from '../generated/contracts/index'
import * as session from './session'
import { markRead } from './messages'

interface ReadJob {
  peer: string | null
  target: IAnonymousChatTarget | null
  ids: string[]
  attempts: number
  retryAt: number
}

const queues = new Map<string, ReadJob[]>()
const running = new Set<string>()
let active = true
const storageKey = (owner: string) => `pending_message_reads_v1:${encodeURIComponent(owner)}`

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('已读重试记录损坏')
  return value as Record<string, unknown>
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new Error('已读重试目标无效')
  return value
}

function parseJob(value: unknown): ReadJob {
  const job = record(value)
  let target: IAnonymousChatTarget | null = null
  if (job.target !== null) {
    const input = record(job.target)
    if (input.anonymous !== true || (input.type !== 'post' && input.type !== 'comment')) throw new Error('已读重试目标无效')
    target = { anonymous: true, type: input.type, id: identifier(input.id) }
    if (input.thread_id !== undefined) target.thread_id = identifier(input.thread_id)
  }
  const peer = job.peer === null ? null : identifier(job.peer)
  if ((!peer && !target) || (peer && target)
    || typeof job.attempts !== 'number' || !Number.isSafeInteger(job.attempts) || job.attempts < 0 || job.attempts > 6
    || typeof job.retryAt !== 'number' || !Number.isSafeInteger(job.retryAt) || job.retryAt < 0) throw new Error('已读重试记录损坏')
  return { peer, target, ids: parseReadMessageIds(job.ids), attempts: job.attempts, retryAt: job.retryAt }
}

function load(owner: string): ReadJob[] {
  const cached = queues.get(owner)
  if (cached) return cached
  const stored: unknown = wx.getStorageSync(storageKey(owner))
  let jobs: ReadJob[] = []
  if (stored !== undefined && stored !== null && stored !== '') {
    const envelope = record(stored)
    if (envelope.version !== 1 || !Array.isArray(envelope.jobs) || envelope.jobs.length > 500) throw new Error('已读重试记录损坏')
    jobs = envelope.jobs.map(parseJob)
  }
  queues.set(owner, jobs)
  return jobs
}

function persist(owner: string, jobs: ReadJob[]): void {
  if (jobs.length) wx.setStorageSync(storageKey(owner), { version: 1, jobs })
  else wx.removeStorageSync(storageKey(owner))
}

export function setReadQueueActive(value: boolean): void { active = value }

/** Persist intent before attempting the idempotent server mutation. Never store message bodies. */
export async function acknowledgeMessages(peer: string | undefined, ids: string[], target?: IAnonymousChatTarget | null): Promise<void> {
  const owner = session.getOpenid()
  if (!owner || session.getState() !== 'verified') return
  const jobs = load(owner)
  const targetKey = JSON.stringify(target ? [target.type, target.id, target.thread_id] : [peer])
  const known = new Set(jobs.filter(job => JSON.stringify(job.target
    ? [job.target.type, job.target.id, job.target.thread_id] : [job.peer]) === targetKey).flatMap(job => job.ids))
  const pending = [...new Set(ids)].filter(id => !known.has(id))
  if (jobs.length + Math.ceil(pending.length / READ_BATCH_SIZE) > 500) throw new Error('待重试已读记录过多，请稍后重试')
  const added: ReadJob[] = []
  for (let offset = 0; offset < pending.length; offset += READ_BATCH_SIZE) {
    added.push(parseJob({ peer: target ? null : peer || null, target: target || null,
      ids: pending.slice(offset, offset + READ_BATCH_SIZE), attempts: 0, retryAt: 0 }))
  }
  jobs.push(...added)
  persist(owner, jobs)
  await flushReadAcknowledgements()
}

/** Reuses foreground polling; one drain attempts at most 100 IDs across five transactions. */
export async function flushReadAcknowledgements(): Promise<void> {
  const owner = session.getOpenid()
  if (!active || !owner || session.getState() !== 'verified' || running.has(owner)) return
  const revision = session.getRevision()
  const jobs = load(owner)
  running.add(owner)
  try {
    const due = jobs.filter(job => job.retryAt <= Date.now()).slice(0, 5)
    for (const job of due) {
      if (!active || session.getRevision() !== revision || session.getState() !== 'verified') return
      try {
        await markRead(job.peer || undefined, job.ids, job.target)
        if (session.getRevision() !== revision) return
        const index = jobs.indexOf(job)
        if (index >= 0) jobs.splice(index, 1)
      } catch (_) {
        if (session.getRevision() !== revision) return
        job.attempts = Math.min(6, job.attempts + 1)
        job.retryAt = Date.now() + Math.min(60000, 1000 * 2 ** job.attempts)
      }
      persist(owner, jobs)
    }
    // Retry local cleanup too if a previous successful server write could not be saved.
    persist(owner, jobs)
  } finally { running.delete(owner) }
}
