# AUDIT-004: comment_count/post_count can go negative

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | low |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`cloudfunctions/comments/index.js:85` and `cloudfunctions/posts/index.js:76,109` — `_.inc(-1)` on counters can go negative if the delete operation runs twice (race condition, retry, or manual DB manipulation). CloudBase `_.inc(-1)` allows negative values.

## Fix

Add guard: only decrement if `> 0`. Or use `_.inc(-1)` with a where clause `{ comment_count: _.gt(0) }`.


## Resolution (2026-07-23)

帖子/评论计数在事务中按当前状态转换更新，并通过非负计数 helper 保护。
