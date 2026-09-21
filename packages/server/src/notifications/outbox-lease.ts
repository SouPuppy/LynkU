export interface OutboxLease { attemptCount: number; leaseUntil: number }
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid outbox event')
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid outbox counter')
  return value
}
export function nextOutboxLease(value: unknown, now: number): OutboxLease | null {
  integer(now)
  if (value === null || value === undefined) return null
  const event = row(value)
  if (event.status === 'delivered') return null
  if (event.status !== 'pending' && event.status !== 'processing') throw new Error('Invalid outbox status')
  const availableAt = event.status === 'processing' ? integer(event.lease_until) : integer(event.next_attempt_at)
  if (availableAt > now) return null
  const attemptCount = integer(event.attempt_count) + 1
  const leaseUntil = now + 30000
  integer(attemptCount); integer(leaseUntil)
  return { attemptCount, leaseUntil }
}
export function ownsOutboxLease(value: unknown, attemptCount: number): boolean {
  integer(attemptCount)
  if (value === null || value === undefined) return false
  const event = row(value)
  return event.status === 'processing' && event.attempt_count === attemptCount
}
