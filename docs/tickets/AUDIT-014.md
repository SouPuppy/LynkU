# AUDIT-014: onNotifRetry referenced in WXML but not implemented in TS

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/messages/messages.wxml:61` binds `bindtap="onNotifRetry"` but `messages.ts` has no such method. Tapping retry on notification error state does nothing.

## Fix

Add `onNotifRetry()` method that calls `this.loadNotifications(true)`.


## Resolution (2026-07-23)

消息页补齐 `onNotifRetry`。
