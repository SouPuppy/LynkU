# CLOUD-004: Cloud Functions — Messages

| Field | Value |
|-------|-------|
| ID | CLOUD-004 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | high |
| Depends on | CLOUD-002 |

## Scope

- **cf-messages**: action='send' (validate recipient, idempotency via msg_id), action='listConversations' (grouped by peer, last message, unread count), action='getConversation' (paginated history), action='markRead'

## Out of Scope

- Group chats
- Message reactions
- Typing indicators

## Refs

- `docs/design/cloudbase-migration/module_specs.json` (cf-messages)


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
