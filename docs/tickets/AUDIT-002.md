# AUDIT-002: view_count increment is client-side write — may silently fail

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`services/posts.ts:40` — `getPost` increments view_count via direct client-side DB write:
```typescript
coll.posts.doc(postId).update({ data: { view_count: _.inc(1) } })
```

If the `posts` collection has write ACL restricted to cloud functions (common CloudBase setup), this silently fails. The `.catch(() => {})` swallows the error.

## Fix

Move view_count increment to a cloud function (`posts` CF with `action: 'view'`).


## Resolution (2026-07-23)

帖子详情由 `posts?action=get` 在服务端增加阅读数，客户端不再写库。
