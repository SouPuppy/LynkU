export type OverviewMetricKey = 'users' | 'verifiedUsers' | 'posts' | 'openCases'
export interface OverviewMetric { value: number | null; state: 'available' | 'unavailable' | 'forbidden' }
export interface OverviewStore { count(key: OverviewMetricKey): Promise<number>; now(): string }
/** Independent counters are observations, not a cross-collection transaction snapshot. */
export async function readAdminOverview(store: OverviewStore, capabilities: readonly string[]) {
  const entries = await Promise.all((['users', 'verifiedUsers', 'posts', 'openCases'] as const).map(async key => {
    const required = key === 'openCases' ? 'governance:write' : key === 'posts' ? 'content:read' : 'users:read'
    let metric: OverviewMetric
    if (!capabilities.includes(required)) metric = { value: null, state: 'forbidden' }
    else {
      try {
        const value = await store.count(key)
        if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid metric')
        metric = { value, state: 'available' }
      } catch { metric = { value: null, state: 'unavailable' } }
    }
    return [key, metric] as const
  }))
  return { metrics: Object.fromEntries(entries) as Record<OverviewMetricKey, OverviewMetric>, observedAt: store.now() }
}
