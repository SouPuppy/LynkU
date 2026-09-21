# AUDIT-008: post page — watchComments triggers full reload instead of incremental update

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/post/post.ts:164-171` — the `watchComments` onChange callback calls `this.loadComments()` which re-fetches ALL comments and rebuilds the tree. Instead, it should incrementally update the comment list using the `changes` parameter from the watch snapshot.

This causes:
- Unnecessary network requests on every comment change
- Tree rebuild flicker (comments flash during reload)
- Scroll position loss

## Fix

Use `snapshot.docChanges` to apply incremental updates to `this.data.comments` instead of calling `loadComments()`.


## Resolution (2026-07-23)

评论轮询以脱敏快照生成增删改差异，页面应用差异而不是再次全量请求。
