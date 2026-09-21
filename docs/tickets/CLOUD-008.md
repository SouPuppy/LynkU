# CLOUD-008: Cleanup + Documentation

| Field | Value |
|-------|-------|
| ID | CLOUD-008 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | medium |
| Depends on | CLOUD-006, CLOUD-007 |

## Scope

- Delete `mock/` directory
- Remove old JWT-related code from `services/auth.ts`
- Remove old `services/api.ts` (wx.request wrapper)
- Remove old `mp-ws-client` references
- Update `docs/DEVELOPMENT.md` with CloudBase setup instructions
- Update `README.md` architecture diagram
- Mark old design docs (lucky-bbs/*) as superseded with pointer to cloudbase-migration/
- Verify no orphaned imports or references to deleted modules

## Refs

- `docs/design/cloudbase-migration/PRFAQ.md`


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
