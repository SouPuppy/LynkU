# AUDIT-027: 审核内容会污染公开帖子与评论计数

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Problem

敏感词命中后，帖子/评论会以 `flagged` 状态保存且不会出现在公开列表中，但计数仍无条件增加：

- `cloudfunctions/posts/index.js:45-56` 对 flagged 帖子增加分类 `post_count`。
- `cloudfunctions/comments/index.js:39-50` 对 flagged 评论增加帖子 `comment_count`。

`flagPost` 在 flagged/published 之间切换时不调整分类计数；帖子更新导致 published/flagged 状态变化时也不调整。页面展示的“篇帖子”和“评论”数量因此可能大于用户实际可见的条目。

这些计数更新又是未等待的独立写入，主写成功而计数失败时不会重试或报告。

## Recommended Fix

先定义计数语义；若表示公开可见数量，只在进入/离开 `published` 时按状态转换调整，并将主记录与计数更新放入事务或可重试的一致性流程。

## Acceptance Criteria

- 分类 `post_count` 等于该分类 published 帖子数。
- 帖子 `comment_count` 等于该帖子 published 评论数。
- create、delete、update、flag/unflag 的所有状态转换都有计数测试。
- 任一写入失败不会留下不可检测的半完成状态。


## Resolution (2026-07-23)

published 状态转换在事务中维护分类/评论计数，flagged 内容不计入公开数量。
