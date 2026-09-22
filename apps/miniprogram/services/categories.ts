import { parseCategoryList, type CategoryView } from '../generated/contracts/index'
import { callCloud, CloudCallError } from './cloud'

export async function listCategories(): Promise<CategoryView[]> {
  const value = await callCloud<unknown>('categories', { action: 'list' })
  try { return parseCategoryList(value) } catch (_) {
    throw new CloudCallError('分类返回了无效数据', 'INVALID_RESPONSE', 'categories', 'list')
  }
}
