# AUDIT-012: findComment returns wrong object for reply deletion auth

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/post/post.ts:152-160` — `findComment` returns the PARENT comment when matching a reply's `_id`. The deletion auth check then compares against the parent's `_openid`, not the reply's.

Currently dormant because WXML only binds longpress on top-level comments (not replies). But if UI ever supports reply deletion, this auth check is wrong.

## Fix

Return the actual reply object, not the parent. Or add separate delete handling for replies.


## Resolution (2026-07-23)

回复删除返回实际回复对象，组件对回复也绑定长按删除事件。
