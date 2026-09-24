export interface ContactBlock { id: string; label: string }
export interface ContactBlockPage { items: ContactBlock[]; nextCursor: string | null }
export function parseContactBlockPage(value: unknown): ContactBlockPage {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items) || value.items.length > 20
    || !('nextCursor' in value) || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(value.nextCursor)))) throw Error('Invalid contact blocks')
  const items = value.items.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !/^[a-f0-9]{64}$/.test(entry.id)
      || !('label' in entry) || typeof entry.label !== 'string' || !entry.label || entry.label.length > 128) throw Error('Invalid contact block')
    return { id: entry.id, label: entry.label }
  })
  if (value.nextCursor !== null && value.nextCursor !== items[items.length - 1]?.id) throw Error('Invalid block cursor')
  if (new Set(items.map(item => item.id)).size !== items.length) throw Error('Duplicate block operation')
  return { items, nextCursor: value.nextCursor }
}
