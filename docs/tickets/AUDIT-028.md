# AUDIT-028: 共享输入校验允许仅空白内容

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`cloudfunctions/common/index.js:12-16` 的 `validateInput` 在原始字符串上检查非空和长度，业务代码在通过校验后才调用 `trim()`。因此 `'   '` 会通过 `minLen: 1`，最终保存为空字符串。

受影响的不只是 `AUDIT-005` 记录的消息，还包括帖子标题/正文、评论、分类名称和用户昵称。云函数不能依赖当前客户端已经 trim，因为调用者可直接构造请求。

`drafts` 为了允许空草稿传入 `title || ''`，又会被共享校验器判为“输入不能为空”，导致刚开始输入、只有标题或只有正文时自动保存失败，与草稿语义冲突。

## Recommended Fix

让校验器显式支持 `trim` 和 `allowEmpty` 规则，并返回规范化后的值；必填业务字段校验 trim 后长度，草稿字段允许空但仍限制最大长度。

## Acceptance Criteria

- 帖子、评论、消息、分类和昵称拒绝仅空白字符串。
- 空标题或空正文的草稿可以保存，超长草稿仍被拒绝。
- 边界测试覆盖空字符串、空白字符串、恰好最小/最大长度和 trim 后超界。


## Resolution (2026-07-23)

共享校验器先 trim，支持 allowEmpty；必填字段拒绝空白，草稿允许空值但限制长度。
