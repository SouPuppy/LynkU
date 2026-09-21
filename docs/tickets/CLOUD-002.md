# CLOUD-002: Cloud Functions — Login + Users + Shared Utils

| Field | Value |
|-------|-------|
| ID | CLOUD-002 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | high |
| Depends on | CLOUD-001 |

## Scope

- **cf-utils** (CloudBase layer): sensitive word filter, input validation, error formatting, admin check helper
- **cf-login**: action='ensure' → find or create user by context.OPENID, return profile
- **cf-users**: action='updateProfile' (sync denormalized author data), action='getProfile'

## Out of Scope

- Content CRUD (CLOUD-003)
- Messaging (CLOUD-004)

## Refs

- `docs/design/cloudbase-migration/module_specs.json` (cf-login, cf-users, cf-utils)


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
