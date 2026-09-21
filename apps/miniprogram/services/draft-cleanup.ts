import * as session from './session'
import { deleteDraft } from './drafts'
import { CloudCallError } from './cloud'
import { parseDraftId } from '../generated/contracts/index'
interface Cleanup { id: string; revision: number; attempts: number; after: number }
let active = true
let running: Promise<void> | null = null
const key = (owner: string) => `draft_cleanup_v1:${encodeURIComponent(owner)}`
function read(owner: string): Cleanup[] {
  const value: unknown = wx.getStorageSync(key(owner))
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid draft cleanup queue')
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid cleanup job')
    const row = item as Record<string, unknown>
    const id = parseDraftId(row.id)
    if (typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1
      || typeof row.attempts !== 'number' || !Number.isInteger(row.attempts) || row.attempts < 0 || row.attempts > 6
      || typeof row.after !== 'number' || !Number.isSafeInteger(row.after) || row.after < 0) throw new Error('Invalid cleanup job')
    return { id, revision: row.revision, attempts: row.attempts, after: row.after }
  })
}
export function setDraftCleanupActive(value: boolean): void { active = value }
/** Persist before deleting anything. Failure leaves the cloud draft intact. */
export function enqueueDraftCleanup(id: string, revision: number): void {
  const owner = session.getOpenid()
  if (!owner || session.getState() !== 'verified') throw new Error('Missing cleanup owner')
  parseDraftId(id)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Missing cleanup revision')
  const jobs = read(owner)
  if (jobs.some(job => job.id === id && job.revision === revision)) return
  if (jobs.length >= 100) throw new Error('Draft cleanup queue is full')
  wx.setStorageSync(key(owner), [...jobs, { id, revision, attempts: 0, after: 0 }])
}
export async function flushDraftCleanup(): Promise<void> {
  if (running) return running
  const owner = session.getOpenid(), revision = session.getRevision()
  if (!active || !owner || session.getState() !== 'verified') return
  const current = () => active && session.getRevision() === revision && session.getOpenid() === owner
  const work = async () => {
    for (let index = 0; index < 5 && current(); index++) {
      const job = read(owner).find(item => item.after <= Date.now())
      if (!job) break
      let done = false
      try { await deleteDraft(job.id, job.revision); done = true } catch (error) {
        // A newer draft belongs to the user and must survive automatic cleanup.
        done = error instanceof CloudCallError && error.code === 'DRAFT_CONFLICT'
      }
      if (!current()) return
      const jobs = read(owner).filter(item => item.id !== job.id || item.revision !== job.revision)
      if (!done) {
        const attempts = Math.min(job.attempts + 1, 6)
        jobs.push({ ...job, attempts, after: Date.now() + Math.min(60000, 1000 * 2 ** attempts) })
      }
      wx.setStorageSync(key(owner), jobs)
    }
  }
  running = work()
  try { await running } finally { running = null }
}
