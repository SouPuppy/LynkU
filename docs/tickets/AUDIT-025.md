# AUDIT-025: 通知标记已读后本地红点状态不更新

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | low |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`pages/messages/messages.ts:63-70,115-123` 和 `pages/notifications/notifications.ts:52-59` 调用 `markNotificationsRead` 后，只更新未读数字或完全不更新本地列表。`notifications[*].read` 仍为 `false`，所以 `notification-card.wxml:19` 的红点会一直显示，直到下一次完整重载。

请求失败时，消息页仍会立即把 `notifUnread` 设为 0，导致角标与服务端真实状态相反。

## Recommended Fix

等待标记请求成功后，以不可变方式把对应本地通知的 `read` 更新为 `true`，再刷新角标；失败时保留原状态并允许重试。

## Acceptance Criteria

- 打开通知页后，已成功标记的通知红点立即消失。
- 标记请求失败时红点和角标不会被乐观清零。
- 重新进入页面后的服务端状态与本地显示一致。


## Resolution (2026-07-23)

已读请求成功后以不可变方式更新本地通知并重新取服务端未读数，失败保留红点。
