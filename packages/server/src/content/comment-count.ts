export function nextPostCommentCount(value: unknown, delta: 1 | -1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('Invalid comment count')
  const next = value + delta
  if (!Number.isSafeInteger(next) || next < 0) throw Error('Invalid comment count transition')
  return next
}
