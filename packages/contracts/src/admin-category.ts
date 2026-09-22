import { parseCategoryView, type CategoryView } from './categories'
export interface ManagedCategory extends CategoryView { managementRevision: number }
export interface CategoryChange { requestId: string; category: ManagedCategory; reason: string }
export interface CategoryChangeReceipt { requestId: string; category: ManagedCategory; appliedAt: string }
export interface CategoryCreation { requestId: string; name: string; description: string; sort_order: number; status: 'active' | 'hidden'; reason: string }
export function parseCategoryCreation(value: unknown): CategoryCreation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid category creation')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['action', 'requestId', 'name', 'description', 'sort_order', 'status', 'reason'].includes(key))) throw Error('Unknown category creation field')
  const parsed = parseCategoryChange({ requestId: input.requestId, reason: input.reason, category: { _id: 'new', name: input.name, description: input.description, sort_order: input.sort_order, status: input.status, post_count: 0, managementRevision: 0 } })
  return { requestId: parsed.requestId, reason: parsed.reason, name: parsed.category.name, description: parsed.category.description, sort_order: parsed.category.sort_order, status: parsed.category.status }
}
export function parseManagedCategoryList(value: unknown): ManagedCategory[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid managed categories')
  const rows = (value as Record<string, unknown>).categories
  if (!Array.isArray(rows) || rows.length > 100) throw Error('Invalid managed categories')
  const items = rows.map(parseManagedCategory)
  if (new Set(items.map(item => item._id)).size !== items.length) throw Error('Duplicate managed category')
  return items
}
export function parseCategoryChangeReceipt(value: unknown): CategoryChangeReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid change receipt')
  const row = value as Record<string, unknown>
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(row.requestId) || typeof row.appliedAt !== 'string'
    || !Number.isFinite(Date.parse(row.appliedAt))) throw Error('Invalid change receipt')
  return { requestId: row.requestId, appliedAt: row.appliedAt, category: parseManagedCategory(row.category) }
}
export function parseManagedCategory(value: unknown): ManagedCategory {
  const category = parseCategoryView(value)
  const revision = (value as Record<string, unknown>).managementRevision
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw Error('Invalid category revision')
  return { ...category, managementRevision: revision }
}
export function parseCategoryChange(value: unknown): CategoryChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid category change')
  const row = value as Record<string, unknown>
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(row.requestId)
    || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500) throw Error('Invalid category change reason or request')
  return { requestId: row.requestId, reason: row.reason.trim(), category: parseManagedCategory(row.category) }
}
