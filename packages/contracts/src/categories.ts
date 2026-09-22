export interface CategoryView { _id: string; name: string; description: string; sort_order: number; post_count: number; status: 'active' | 'hidden' }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid category')
  return value as Record<string, unknown>
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum) throw Error('Invalid category text')
  return value.trim()
}
export function parseCategoryView(value: unknown): CategoryView {
  const row = object(value)
  if ((row.status !== 'active' && row.status !== 'hidden') || typeof row.sort_order !== 'number' || !Number.isSafeInteger(row.sort_order)
    || typeof row.post_count !== 'number' || !Number.isSafeInteger(row.post_count) || row.post_count < 0) throw Error('Invalid category state')
  return { _id: text(row._id, 128), name: text(row.name, 50), description: text(row.description, 500, true),
    sort_order: row.sort_order, post_count: row.post_count, status: row.status }
}
export function parseCategoryList(value: unknown): CategoryView[] {
  const row = object(value)
  if (!Array.isArray(row.categories) || row.categories.length > 100) throw Error('Invalid category list')
  const items = row.categories.map(parseCategoryView)
  if (items.some(item => item.status !== 'active') || new Set(items.map(item => item._id)).size !== items.length) throw Error('Invalid category scope')
  return items
}
export function parseCategoryFields(value: unknown): Pick<CategoryView, 'name' | 'description'> {
  const row = object(value)
  return { name: text(row.name, 50), description: text(row.description === undefined ? '' : row.description, 500, true) }
}
export function parseCategoryUpdate(value: unknown): { id: string; fields: Partial<Pick<CategoryView, 'name' | 'description' | 'status'>> } {
  const row = object(value), fields: Partial<Pick<CategoryView, 'name' | 'description' | 'status'>> = {}
  if (row.name !== undefined) fields.name = text(row.name, 50)
  if (row.description !== undefined) fields.description = text(row.description, 500, true)
  if (row.status !== undefined) {
    if (row.status !== 'active' && row.status !== 'hidden') throw Error('Invalid category status')
    fields.status = row.status
  }
  if (!Object.keys(fields).length) throw Error('Empty category update')
  return { id: text(row.category_id, 128), fields }
}
