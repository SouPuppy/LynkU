# CLOUD-006: Frontend Page Refactor + Mock Removal

| Field | Value |
|-------|-------|
| ID | CLOUD-006 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | high |
| Depends on | CLOUD-005 |

## Scope

- Rewire all pages to call services/ instead of old request()
- Remove all mock data imports (mock/*.json references)
- Add LoadState coverage (loading/empty/error/loaded) on all data-fetching views
- Use shared `<empty-state>` and `<error-view>` components
- Forum feed: direct DB read via posts.list()
- Post detail: direct DB read + comment tree building
- Create post: cloud function call via posts.create()
- Profile: cloud function call via users.updateProfile()

## Out of Scope

- Chat UI real-time updates (CLOUD-007)
- New UI features

## Refs

- `docs/design/cloudbase-migration/module_specs.json` (mp-pages)
- `docs/research/frontend-design-principles.md` (Principles 1, 5, 6)


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。

原票据中的“公开内容直接 DB read”已按 AUDIT-018/023 的安全验收调整为云函数 DTO read，页面状态与分页行为保持不变。
