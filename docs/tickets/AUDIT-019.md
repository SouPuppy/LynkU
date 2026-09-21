# AUDIT-019: 修改资料会改写匿名历史内容的作者快照

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`cloudfunctions/users/index.js:98-125` 的 `syncAuthorData` 仅按真实 OPENID 更新：

- 所有 `posts` 的 `author.nickname/avatar_url`
- 所有 `comments` 的 `author.nickname/avatar_url`
- 所有 `notifications` 的 `actor.nickname/avatar_url`

查询没有排除 `anonymous: true`，通知记录也没有匿名标记。因此用户修改昵称或头像后，历史匿名帖子、评论和通知会从“匿名用户”变成真实资料，造成可见的去匿名化。

此外，函数收集了 `contentSync` Promise 却从未 `Promise.all` 或返回它；云函数可能在同步写完成前结束。清空头像时又因 `if (updates.avatar_url)` 为 false 而不会传播空字符串。

## Recommended Fix

- 只同步明确的非匿名内容，例如查询增加 `anonymous: _.neq(true)`。
- 为通知持久化匿名状态，并排除匿名通知。
- 让 `syncAuthorData` 返回 Promise，在 `ensureUser`/`updateProfile` 中 `await`。
- 用字段是否存在而不是 truthy 判断，以支持清空头像。

## Acceptance Criteria

- 修改昵称/头像后，匿名历史记录仍显示“匿名用户”和默认头像。
- 非匿名内容、评论和通知在接口返回前完成同步。
- 清空头像能同步到全部非匿名快照。


## Resolution (2026-07-23)

资料同步 await 完成，排除匿名内容，且使用字段存在性传播空头像。
