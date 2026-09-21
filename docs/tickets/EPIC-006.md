# EPIC-006: User Profile Page + Identity (G-4 + G-5)

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | epic |
| Priority | high |
| Parent | null |
| Design Dir | docs/design/user-profile/ |
| Design Verdict | PROCEED |
| Created | 2026-07-23 |

## Scope

- User profile page: avatar, nickname, unique handle, join date, post count, recent posts
- "发私信" button → chat page
- Update all tap-to-chat handlers: avatar/name → profile (instead of → chat)
- Unique identity: `@` + truncated openid as visible handle

## Out of Scope

- Custom usernames
- User search/directory
- Follow/block
- Edit profile (already in settings page)

## Child Tickets

- PRO-001: User profile page — UI + data loading
- PRO-002: Update tap handlers — route to profile instead of chat
- PRO-003: Add post count to users service


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
