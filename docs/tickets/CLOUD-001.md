# CLOUD-001: CloudBase Environment + Database Setup

| Field | Value |
|-------|-------|
| ID | CLOUD-001 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | high |
| Depends on | — |

## Scope

- Create CloudBase environment in WeChat DevTools
- `wx.cloud.init({env, traceUser: true})` in `app.ts`
- Create 5 collections: users, posts, comments, messages, categories
- Create indexes per topology model
- Configure collection permissions
- Write `services/db.ts` + `services/cloud.ts`
- Write TypeScript types for all document shapes

## Out of Scope

- Cloud function deployment (CLOUD-002/003/004)
- Page data integration (CLOUD-006)

## Refs

- `docs/design/cloudbase-migration/topology_model.json`
- `docs/design/cloudbase-migration/module_specs.json`


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。

集合、权限、索引和环境变量清单已写入 `docs/DEVELOPMENT.md`；CloudBase 控制台中的实际创建/部署仍属于环境操作，不会在本地静态检查中伪造为已执行。
