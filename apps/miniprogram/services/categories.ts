// services/categories.ts — Category data access
// Reads and writes go through cloud functions so client permissions cannot
// make topic loading differ between environments.

import type { ICategory } from '../typings/cloudbase'
import { callCloud } from './cloud'

/** List all active categories */
export async function listCategories(): Promise<ICategory[]> {
  const res = await callCloud<{ categories: ICategory[] }>('categories', {
    action: 'list',
  })
  return res.categories
}

/** Seed default categories if collection is empty (idempotent) */
export async function seedCategories(): Promise<ICategory[]> {
  const res = await callCloud<{ categories: ICategory[]; seeded: boolean }>('categories', {
    action: 'seed',
  })
  return res.categories
}

/** Create category (admin only, via cloud function) */
export async function createCategory(data: {
  name: string
  description: string
}): Promise<ICategory> {
  const res = await callCloud<{ category: ICategory }>('categories', {
    action: 'create',
    name: data.name,
    description: data.description,
  })
  return res.category
}
