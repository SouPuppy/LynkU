export interface OutboxDeliveryPort {
  candidates(): Promise<string[]>
  claim(id: string): Promise<{ event: unknown; attemptCount: number } | null>
  deliver(event: unknown): Promise<void>
  finish(id: string, attemptCount: number, delivered: boolean): Promise<boolean>
}
export async function drainOutbox(port: OutboxDeliveryPort, ids?: string[]): Promise<{ attempted: number; delivered: number; failed: number }> {
  const candidates = ids ?? await port.candidates()
  if (candidates.length > 50 || new Set(candidates).size !== candidates.length) throw Error('Invalid outbox batch')
  const results = await Promise.allSettled(candidates.map(async id => {
    const claimed = await port.claim(id)
    if (!claimed) return false
    try { await port.deliver(claimed.event); return await port.finish(id, claimed.attemptCount, true) }
    catch (error) { await port.finish(id, claimed.attemptCount, false); throw error }
  }))
  return { attempted: candidates.length, delivered: results.filter(item => item.status === 'fulfilled' && item.value).length,
    failed: results.filter(item => item.status === 'rejected').length }
}
