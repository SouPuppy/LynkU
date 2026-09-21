# AUDIT-003: seedCategories has no auth check + race condition

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | low |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`cloudfunctions/categories/index.js:49` — `seedCategories` has no auth check. Anyone can call it. If the collection is empty (e.g., after clear-db), any user triggers seeding.

Also: race condition — two users call it simultaneously, both see `count() === 0`, both insert. Currently handled by `catch` skipping duplicates, but it's messy.

## Fix

Add `checkAdmin` guard to `seedCategories` (same as `createCategory`).


## Resolution (2026-07-23)

分类 seed 现在要求管理员身份；生产数据库文档要求唯一名称索引。
