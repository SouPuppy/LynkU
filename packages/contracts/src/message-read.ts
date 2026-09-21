export const READ_BATCH_SIZE = 20

export function parseReadMessageIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > READ_BATCH_SIZE
    || value.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new Error('Invalid message IDs')
  return [...new Set(value as string[])]
}

export function parseReadResult(value: unknown, maximum: number): number {
  if (!value || typeof value !== 'object' || !('updated' in value)
    || typeof value.updated !== 'number' || !Number.isSafeInteger(value.updated)
    || value.updated < 0 || value.updated > maximum) throw new Error('Invalid read result')
  return value.updated
}

export function parseReadReceipts(value: unknown, requestedIds: string[]): string[] {
  if (!value || typeof value !== 'object' || !('readIds' in value) || !Array.isArray(value.readIds)
    || value.readIds.length > requestedIds.length
    || value.readIds.some(id => typeof id !== 'string' || !requestedIds.includes(id))) throw new Error('Invalid read receipts')
  return [...new Set(value.readIds as string[])]
}
