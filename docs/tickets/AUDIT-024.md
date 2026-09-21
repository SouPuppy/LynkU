# AUDIT-024: createNotification 允许客户端伪造任意通知

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`cloudfunctions/messages/index.js:16,143-199` 将 `createNotification` 暴露为普通云函数 action。`withAuth` 只能证明调用者有 OPENID，不能证明调用来自另一个可信云函数。

任意登录用户可以自行指定 `type`、`targetUserId`、帖子/评论 ID、标题和摘要，向任意用户写入伪造的 `system`、`follow`、`like` 等通知。代码没有类型白名单、目标存在性/归属校验或速率限制。

设计文档 `docs/design/message-hybrid-system/module_specs.json` 的前置条件是“Caller is a cloud function”，当前实现没有满足该边界；实际评论通知也已经在 `comments` 云函数中直接写库，因此该 action 没有可信调用者。

## Recommended Fix

删除公开的 `createNotification` action，由产生业务事件的云函数直接写通知；或建立无法由小程序客户端伪造的服务间鉴权，并按通知类型验证目标关系。

## Acceptance Criteria

- 小程序客户端直接调用 `createNotification` 得到 `FORBIDDEN` 或 `UNKNOWN_ACTION`。
- 通知类型和目标字段由服务端业务事件生成，不能由用户自由填写。
- 有伪造 system 通知和跨用户垃圾通知的负向测试。


## Resolution (2026-07-23)

消息函数移除公开 createNotification action，通知只由评论业务事件写入。
