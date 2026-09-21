# EPIC-005: Unified Messages + Tap-to-Chat + Comment Notification Completion

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | epic |
| Priority | high |
| Parent | null |
| Design Dir | docs/design/unified-messages-tapchat/ |
| Design Verdict | PROCEED |
| Created | 2026-07-23 |

## Scope

- Tabbed Messages UI: 私信 (conversations) + 系统消息 (notifications inline)
- Tap-to-chat: avatar/username tap handlers across post-item, comment-item, post page, notification-card
- Reply notifications: comments CF emits notifications for depth=1 replies
- Unified unread badge on tab bar

## Out of Scope

- Push notifications
- User profile page
- Deleting old notifications page (keep for backward compat)

## Child Tickets

- UNI-001: Unified Messages Tab — tabbed UI with inline notification feed
- UNI-002: Tap-to-Chat — avatar/username tap handlers across all components
- UNI-003: Reply Notifications — fix comments CF, emit reply-type notifications
- UNI-004: Tab Bar Badge — aggregate unread count


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
