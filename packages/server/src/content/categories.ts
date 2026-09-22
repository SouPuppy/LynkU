import { parseCategoryFields, parseCategoryUpdate, parseCategoryView, parseCategoryList, type CategoryView } from '@lynku/contracts'
import { DEFAULT_CATEGORIES } from './default-categories'
import { parseManagedCategoryList, type ManagedCategory } from '@lynku/contracts'

export class CategoryFailure extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'INVALID_CATEGORY' | 'DUPLICATE_NAME' | 'NOT_FOUND') { super(code) }
}
export function categoryNameAllowed(name: string): boolean { return name !== '二手交易' }
export interface CategoryTransaction {
  read(id: string): Promise<unknown | null>
  put(id: string, category: CategoryView): Promise<void>
  update(id: string, fields: Partial<CategoryView>): Promise<void>
}
export interface CategoryStore {
  list(): Promise<unknown[]>
  named(name: string): Promise<unknown[]>
  lastSort(): Promise<number>
  identifier(name: string): string
  run<T>(work: (transaction: CategoryTransaction) => Promise<T>): Promise<T>
}
export interface AdminCategoryStore { listAll(): Promise<unknown[]> }
export async function listActiveCategories(store: Pick<CategoryStore, 'list'>): Promise<{ categories: CategoryView[] }> {
  const categories = (await store.list()).map(parseCategoryView).filter(item => categoryNameAllowed(item.name))
  return { categories: parseCategoryList({ categories }) }
}
export async function listAdminCategories(store: AdminCategoryStore): Promise<{ categories: ManagedCategory[] }> {
  const categories = parseManagedCategoryList({ categories: await store.listAll() }).filter(item => categoryNameAllowed(item.name))
  return { categories }
}
export async function createCategoryRecord(store: CategoryStore, input: unknown): Promise<{ category: CategoryView }> {
  let fields
  try { fields = parseCategoryFields(input) } catch (_) { throw new CategoryFailure('INVALID_INPUT') }
  if (!categoryNameAllowed(fields.name)) throw new CategoryFailure('INVALID_CATEGORY')
  if ((await store.named(fields.name)).length) throw new CategoryFailure('DUPLICATE_NAME')
  const sort = await store.lastSort()
  if (!Number.isSafeInteger(sort) || sort >= Number.MAX_SAFE_INTEGER) throw Error('Invalid category order')
  const category = parseCategoryView({ _id: store.identifier(fields.name), ...fields, sort_order: sort + 1, post_count: 0, status: 'active' })
  await store.run(async tx => {
    if (await tx.read(category._id) !== null) throw new CategoryFailure('DUPLICATE_NAME')
    await tx.put(category._id, category)
  })
  return { category }
}
export async function updateCategoryRecord(store: CategoryStore, input: unknown): Promise<{ category: CategoryView }> {
  let request
  try { request = parseCategoryUpdate(input) } catch (_) { throw new CategoryFailure('INVALID_INPUT') }
  if (request.fields.name !== undefined) {
    if (!categoryNameAllowed(request.fields.name)) throw new CategoryFailure('INVALID_CATEGORY')
    if ((await store.named(request.fields.name)).map(parseCategoryView).some(item => item._id !== request.id)) throw new CategoryFailure('DUPLICATE_NAME')
  }
  return store.run(async tx => {
    const value = await tx.read(request.id)
    if (value === null) throw new CategoryFailure('NOT_FOUND')
    const current = parseCategoryView(value)
    if (current._id !== request.id) throw Error('Invalid category identity')
    const category = parseCategoryView({ ...current, ...request.fields })
    if (category.status === 'active' && !categoryNameAllowed(category.name)) throw new CategoryFailure('INVALID_CATEGORY')
    await tx.update(request.id, request.fields)
    return { category }
  })
}
export async function seedDefaultCategories(store: CategoryStore): Promise<{ categories: CategoryView[]; seeded: boolean }> {
  // Existing named categories are retained; deterministic IDs make retries safe without runtime read-failure fallbacks.
  const existing = await Promise.all(DEFAULT_CATEGORIES.map(item => store.named(item.name)))
  return store.run(async tx => {
    const candidates: CategoryView[] = []
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const item = DEFAULT_CATEGORIES[i]!
      if (existing[i]!.length) continue
      const id = store.identifier(item.name)
      if (await tx.read(id) === null) candidates.push(parseCategoryView({ ...item, _id: id, post_count: 0, status: 'active' }))
    }
    for (const item of candidates) await tx.put(item._id, item)
    return { categories: candidates, seeded: candidates.length > 0 }
  })
}
