# CLOUD-003: Cloud Functions — Posts + Comments + Categories

| Field | Value |
|-------|-------|
| ID | CLOUD-003 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | high |
| Depends on | CLOUD-002 |

## Scope

- **cf-posts**: action='create' (sensitive word filter, flag if matched), action='search' (RegExp), action='delete', action='flag'
- **cf-comments**: action='create' (depth enforcement, parent validation, sensitive words), action='delete'
- **cf-categories**: action='create' (admin only), action='list', action='update'

## Out of Scope

- Messaging (CLOUD-004)
- AI moderation via WeChat API (future)

## Refs

- `docs/design/cloudbase-migration/module_specs.json` (cf-posts, cf-comments, cf-categories)


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
