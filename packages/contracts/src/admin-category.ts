import { parseCategoryView, type CategoryView } from './categories'
export interface ManagedCategory extends CategoryView { managementRevision: number }
export interface CategoryChange { requestId: string; category: ManagedCategory; reason: string }
export interface CategoryChangeReceipt { requestId: string; category: ManagedCategory; appliedAt: string }
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
