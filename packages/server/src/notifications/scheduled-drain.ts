/** Runtime source is injected by the platform adapter, never copied from the event. */
export function isScheduledDrain(source: unknown, openid: unknown, event: unknown, trigger: string): boolean {
  if (source !== 'timer' || (openid !== undefined && openid !== null && openid !== '')) return false
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false
  const input = event as Record<string, unknown>
  return input.Type === 'Timer' && input.TriggerName === trigger
}
