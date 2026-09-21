# AUDIT-001: Editor — no category causes post creation failure

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/editor/editor.ts:227` — when no category is selected, `categoryId` is empty string, and the code passes `'__uncategorized__'` as category_id. The posts cloud function validates that the category exists in the DB — `__uncategorized__` doesn't exist → post creation fails.

## Fix

Either:
A. Require category selection before submit (validate `categoryId` in `onSubmit`)
B. Create a default "未分类" category and use it as fallback
C. Make category_id optional in the cloud function

Recommend A — simplest, best UX (prompt user to pick a category).


## Resolution (2026-07-23)

编辑器提交前要求有效话题 ID，并移除不存在的 `__uncategorized__` 兜底。
