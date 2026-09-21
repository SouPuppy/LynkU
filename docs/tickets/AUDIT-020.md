# AUDIT-020: WXML 将 TS 实例方法当作模板数据使用

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Parent | null |
| Created | 2026-07-23 |

## Problem

项目有 11 处 WXML 表达式直接调用 `fmtTime(...)`、`fmtContent(...)` 或 `statusText(...)`，分布在帖子、评论、草稿、消息、聊天和通知视图中。对应函数都定义在 Page/Component 的方法对象里，不在模板 data 或 WXS 模块中。

WXML 编译器会把这些标识符当作模板环境数据读取；实例方法不会自动进入模板数据环境，因此调用结果是空值。`notification-card.wxml:9-15` 还把 `actionText`、`hasTarget`、`targetPreview` 方法直接当普通数据读取，导致操作文案和目标摘要为空。

## Evidence

- `components/post-item/post-item.wxml:9,14`
- `components/comment-item/comment-item.wxml:15,35,52`
- `components/chat-bubble/chat-bubble.wxml:7-8`
- `components/notification-card/notification-card.wxml:9-17`
- `pages/drafts/drafts.wxml:25`
- `pages/messages/messages.wxml:40`
- `pages/post/post.wxml:10`

## Recommended Fix

在数据进入 `setData` 前生成展示字段，或把纯格式化函数迁移到 WXS；不要从 WXML 调用 Page/Component methods。

## Acceptance Criteria

- 所有时间、帖子摘要、消息状态、通知动作和目标摘要都能稳定显示。
- `rg '\{\{[^}]*[A-Za-z_$][A-Za-z0-9_$]*\(' miniprogram -g '*.wxml'` 不再命中 TS 实例方法调用。
- 帖子、评论、消息和通知各有至少一个渲染验证用例。


## Resolution (2026-07-23)

时间、摘要、状态和通知文案在组件 observer/页面加载阶段生成；WXML 调用扫描已清零。
