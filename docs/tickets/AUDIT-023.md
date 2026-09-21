# AUDIT-023: 已删除或审核中的帖子可通过 ID 直接读取

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`miniprogram/services/posts.ts:34-45` 的 `getPost` 直接执行 `coll.posts.doc(postId).get()`，没有检查 `status`。详情页和编辑页都调用该方法。

列表/搜索只返回 `published`，但知道文档 ID 的用户仍可通过 `/pages/post/post?id=<id>` 查看 `deleted`、`flagged` 或 `hidden` 内容。详情读取还会尝试增加这些内容的阅读数。

## Recommended Fix

公开详情查询必须限制 `status: 'published'`。作者查看审核状态、编辑，以及管理员审核应走云函数，在服务端分别验证作者/管理员权限。

## Acceptance Criteria

- 普通用户无法通过旧链接读取 deleted/flagged/hidden 帖子的标题和正文。
- 作者只能通过受控路径查看自己的审核中内容，不能编辑他人内容。
- 非公开内容不会增加 `view_count`。


## Resolution (2026-07-23)

公开详情只返回 published；作者编辑和管理员审核走服务端授权路径。
