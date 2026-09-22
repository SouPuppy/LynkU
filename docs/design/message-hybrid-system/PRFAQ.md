# PR/FAQ: Message Hybrid System — Notification Stub + DM Conversations

## Problem

The current LynkU "私信" (Messages) tab is a flat conversation list. Users can
only see 1:1 DM threads. There is no way to know when someone comments on your
post, replies to your comment, or interacts with your content. Every social app
(Douyin, WeChat, Xiaohongshu) surfaces interaction notifications alongside DMs
in the same tab -- LynkU currently does not.

Users who post content have to manually check each post for new comments. There
is zero proactive notification. This makes the app feel dead even when people
are engaging with your content.

## Solution

Adopt Douyin's two-tier message architecture:

1. **Stub row** at the top of the messages page -- a synthetic entry labeled
   "消息通知" showing unread notification count and a preview of the most recent
   interaction. Tapping it opens the notification feed.

2. **Notification feed page** (`pages/notifications/notifications`) --
   a scrollable list of interaction cards. Each card shows who did what:
   - "张三 评论了你的帖子" with post title preview
   - "李四 回复了你的评论" with comment preview
   - "王五 关注了你" (future)
   - System announcements (future)

3. **Automatic notification creation** -- when someone comments on your post,
   a notification is created. The comment still succeeds even if notification
   creation fails (fire-and-forget).

The existing DM conversation list remains exactly as it is, below the Stub row.

```
Before:                     After:
┌──────────────────┐       ┌──────────────────┐
│ 张三    你好     │       │ 消息通知   3     │  ← Stub (new)
│ 李四    在吗     │       ├──────────────────┤
│ 王五    看看这个 │       │ 张三    你好     │  ← DM list (unchanged)
│                  │       │ 李四    在吗     │
│                  │       │ 王五    看看这个 │
└──────────────────┘       └──────────────────┘
```

## Customer Quote

> "以前发了帖子不知道有没有人评论，要一个个点进去看。
>  现在打开私信就能看到谁评论了我的帖子，跟抖音一样方便。"

("Before, I didn't know if anyone commented on my posts -- I had to check each
one manually. Now I open Messages and see who commented, just like Douyin.")

## Scope

### In scope
- [x] `INotification` type definition with extensible `NotificationType` enum
- [x] Stub row at top of messages page with unread badge
- [x] New `pages/notifications/notifications` feed page with notification-card component
- [x] Notification creation on top-level comment (commenter != post author)
- [x] Anonymous identity preserved in notifications
- [x] Self-target suppression (no notification for commenting on own post)
- [x] Notification create idempotency (no duplicates for same event)
- [x] Dangling target handling (deleted post/comment → degraded card)
- [x] Cursor-based pagination on notification feed
- [x] Mark-as-read when notification feed is viewed
- [x] Tab bar badge = Stub unread + conversation unread aggregate

### Out of scope
- [ ] Reply notifications (comment-on-comment at depth 1)
- [ ] Like/favorite notifications
- [ ] Follow notifications
- [ ] System announcements / admin broadcast
- [ ] Push notifications (service-side, requires WeChat template message integration)
- [ ] Notification settings/preferences (mute specific types)
- [ ] Real-time polling for new notifications (page refresh onShow is sufficient for v1)

## FAQ

### Why a Stub row instead of a separate tab?
Douyin puts notifications and DMs in the same tab. Splitting them into separate
tabs doubles the navigation surface for no user benefit. The Stub gives
notifications prominence at the top without adding a tab.

### Why fire-and-forget for notification creation?
If a comment succeeds but notification creation fails (quota exceeded, network
blip), the user still gets their comment posted. Rolling back the comment would
be a worse experience. The notification will be created on the next comment.

### Why only top-level comments, not replies?
Replies (depth=1) are less common. Adding both at once doubles the notification
volume and complicates the dedup logic. Top-level comments cover the 80% use case.
Replies can be added by extending the NotificationType enum -- no schema change.

### How does idempotency work?
Before inserting a notification, the cloud function checks for an existing
notification with the same (type, actor, target) within a short time window.
If found, the write is skipped.

### What happens when a post is deleted?
The notification remains but its `target` fields become undefined. The
notification-card component renders a degraded version: "张三 评论了你的帖子
(帖子已删除)" with no deeplink.

## Topology Summary

```
messages-page
  ├── stub-row (index 0) ──tap──→ notifications-page
  │                                └── notification-card × N
  └── conversation list (unchanged)

notifications-service ──→ messages-cloud ──→ notifications-collection
comments-cloud ─────────→ notifications-collection (fire-and-forget)
```

10 modules, 14 edges, 6 boundary conditions, 15 failure modes.
All 9 SC predicates PASS. Verdict: PROCEED.

## Tickets

| # | Ticket | Type | Files |
|---|--------|------|-------|
| T1 | Add INotification type + extend messages cloud function with listNotifications/markRead/createNotification | Backend | `typings/cloudbase.d.ts`, `cloudfunctions/messages/index.js` |
| T2 | Create notifications-service (frontend data access layer) | Frontend | `miniprogram/services/notifications.ts` (new) |
| T3 | Create notification-card component | Frontend | `miniprogram/components/notification-card/` (new) |
| T4 | Create notifications feed page | Frontend | `miniprogram/pages/notifications/` (new) |
| T5 | Add Stub row to messages page + unread badge logic | Frontend | `miniprogram/pages/messages/` |
| T6 | Extend comments cloud function to emit notifications | Backend | `cloudfunctions/comments/index.js` |
| T7 | Register new page + update app.json | Config | `miniprogram/app.json` |
| T8 | Integration: end-to-end flow test (comment → notification → stub badge → feed) | Test | Manual verification |
