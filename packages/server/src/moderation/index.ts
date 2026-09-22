import { ModerationFailure } from '../shared'
export { ModerationFailure } from '../shared'
export interface TextSafetyPort {
  check(input: { openid: string; scene: 1 | 2 | 3; version: 2; content: string }): Promise<unknown>
  clock: ModerationClock
}
export interface ModerationClock {
  now(): number
  schedule(delayMs: number, callback: () => void): () => void
}
export const TEXT_SAFETY_BUDGET = Object.freeze({ segmentMs: 6000, totalMs: 20000, concurrency: 2 })
function suggestion(value: unknown): 'pass' | 'review' | 'risky' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModerationFailure('MODERATION_UNAVAILABLE')
  const row = value as Record<string, unknown>
  if (row.errcode !== 0 || !row.result || typeof row.result !== 'object' || Array.isArray(row.result)) throw new ModerationFailure('MODERATION_UNAVAILABLE')
  const result = row.result as Record<string, unknown>
  if (result.suggest !== 'pass' && result.suggest !== 'review' && result.suggest !== 'risky') throw new ModerationFailure('MODERATION_UNAVAILABLE')
  return result.suggest
}
/** Official v2 checks run before database transactions. Every overlapping segment must be assessed. */
export async function moderateText(port: TextSafetyPort, owner: string, scene: 1 | 2 | 3, content: string): Promise<{ clean: boolean }> {
  if (!owner || !content || content.length > 10201) throw new ModerationFailure('MODERATION_UNAVAILABLE')
  // 1200 Unicode code points occupy at most 2400 UTF-16 units; keep context across boundaries.
  const characters = Array.from(content)
  const segments: string[] = []
  for (let offset = 0; offset < characters.length; offset += 1100) {
    segments.push(characters.slice(offset, offset + 1200).join(''))
    if (offset + 1200 >= characters.length) break
  }
  const deadline = port.clock.now() + TEXT_SAFETY_BUDGET.totalMs
  let next = 0
  let stopped = false
  async function worker(): Promise<void> {
    while (!stopped && next < segments.length) {
      const segment = segments[next++]!
      const callDeadline = Math.min(deadline, port.clock.now() + TEXT_SAFETY_BUDGET.segmentMs)
      if (port.clock.now() >= callDeadline) throw new ModerationFailure('MODERATION_UNAVAILABLE')
      let cancel = () => {}
      try {
        const timeout = new Promise<never>((_, reject) => {
          cancel = port.clock.schedule(callDeadline - port.clock.now(), () => reject(new ModerationFailure('MODERATION_UNAVAILABLE')))
        })
        const raw = await Promise.race([port.check({ openid: owner, scene, version: 2, content: segment }), timeout])
        // A delayed event loop may deliver the SDK result before the expired timer.
        if (stopped || port.clock.now() >= callDeadline) throw new ModerationFailure('MODERATION_UNAVAILABLE')
        if (suggestion(raw) !== 'pass') throw new ModerationFailure('CONTENT_REJECTED')
      } catch (error) {
        stopped = true
        throw error instanceof ModerationFailure ? error : new ModerationFailure('MODERATION_UNAVAILABLE')
      } finally { cancel() }
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(TEXT_SAFETY_BUDGET.concurrency, segments.length) }, () => worker())) }
  catch (error) { stopped = true; throw error }
  return { clean: true }
}
