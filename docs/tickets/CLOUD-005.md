# CLOUD-005: Frontend Service Layer Refactor

| Field | Value |
|-------|-------|
| ID | CLOUD-005 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | high |
| Depends on | CLOUD-003, CLOUD-004 |

## Scope

- Replace `services/api.ts` (wx.request wrapper) with `services/db.ts` + `services/cloud.ts`
- Rewrite `services/auth.ts` — drop JWT, use CloudBase identity
- Create `services/posts.ts`, `services/comments.ts`, `services/messages.ts`, `services/categories.ts`, `services/users.ts`
- Each service: typed function signatures, error normalization, returns domain types
- Create `mp-watch` module: `watch/posts.ts`, `watch/comments.ts`, `watch/messages.ts` with lifecycle management

## Out of Scope

- Page-level wiring (CLOUD-006)
- Real-time chat UI (CLOUD-007)

## Refs

- `docs/design/cloudbase-migration/module_specs.json` (mp-services, mp-watch)
- `docs/research/frontend-design-principles.md` (Principles 1, 3, 11, 12)


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。

为满足匿名隐私边界，服务层的帖子/评论/消息读取统一走云函数；`watch.ts` 是脱敏轮询适配层，而不是直接暴露私有集合的 `db.watch()`。
