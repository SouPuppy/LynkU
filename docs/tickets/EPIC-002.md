---
id: EPIC-002
title: "CloudBase Migration — Replace REST+JWT with WeChat Cloud Development"
status: done
type: epic
priority: high
autonomy: L2
dependencies: []
labels: [cloudbase, migration, wechat-miniprogram]

# == Scope Contract ==
scope:
  - "wx.cloud.init() in app.ts with environment ID"
  - "Cloud functions: login, posts, comments, messages, categories"
  - "Cloud database: collections for users, posts, comments, messages, categories"
  - "Replace services/api.ts (wx.request wrapper) with services/db.ts (cloud DB helpers)"
  - "Rewrite services/auth.ts to use cloud function login (openid, no JWT)"
  - "Migrate all 8 pages from request() calls to cloud API calls"
  - "Remove isMock flag, mock data, token management from entire frontend"
  - "Delete inline mock data in api.ts, post.ts, profile.ts, chat.ts"
  - "Update typings/index.d.ts (remove token, isMock; add cloudEnv)"
  - "Add cloud functions directory with shared utils (sensitive word filter)"
out_of_scope:
  - "CloudBase environment creation (done in WeChat console)"
  - "Database collection creation (done in console UI)"
  - "Cloud function deployment (WeChat DevTools upload)"
  - "Image/file upload via cloud storage"
  - "Admin/moderation cloud functions"
  - "Timer triggers, presence system"
  - "Full-text search beyond db.RegExp"
  - "Real-time messaging via watch() (Phase 2 — use cloud function polling for MVP)"

# == Impact ==
affected_modules:
  - mp-pages (all 8 pages)
  - mp-api-client (delete, replace with cloud-base-client)
  - mp-auth (rewrite)
  - cf-login (new)
  - cf-posts (new)
  - cf-comments (new)
  - cf-messages (new)
  - cf-categories (new)
  - cf-utils (new)
affected_interfaces:
  - IAppOption.globalData (remove token, isMock; add user, cloudEnv)
  - request() API (delete, replace with db.* helpers)
  - login() / logout() / isLoggedIn() / getToken() (rewrite)

# == Meta ==
created: 2026-07-21T04:00:00.000000+00:00
updated: 2026-07-21T04:00:00.000000+00:00
created_by: agent-claude
---

## Description

Migrate the entire LynkU frontend from the old mock/REST+JWT architecture to
WeChat Cloud Development (CloudBase). The old pattern used `wx.request` with JWT
tokens to a self-hosted backend that never materialized. CloudBase provides the
database, cloud functions, and auth natively inside the WeChat runtime.

## Design Decisions

See: [[cloudbase-migration]] PR/FAQ and [[wechat-cloud-development]] research report.

1. **Drop JWT**: CloudBase cloud functions get `context.OPENID` automatically.
   No token generation, storage, refresh, or injection needed.
2. **Direct DB for reads**: Public data (categories, published posts) fetched via
   `wx.cloud.database()` directly — faster, no cloud function invocation cost.
3. **Cloud functions for writes**: All create/update/delete operations go through
   cloud functions with server-side auth checks.
4. **No more mock**: CloudBase IS the backend. Delete `isMock` branching entirely.
5. **Cloud functions as routers**: Each function dispatches by `event.action`
   (list, create, search, delete) — fewer cold starts than one-function-per-action.

## Implementation Plan

### Phase 1: Foundation (CLOUD-001, CLOUD-002)
- Initialize wx.cloud in app.ts
- Create cloud functions with shared utilities
- Update typings

### Phase 2: Service Layer (CLOUD-003)
- Replace api.ts with db.ts
- Rewrite auth.ts

### Phase 3: Pages (CLOUD-004)
- Migrate each page from request() to cloud APIs
- Remove inline mock data

### Phase 4: Cleanup (CLOUD-005)
- Delete all mock code
- Remove old auth patterns
- Verify nothing references token/isMock/wx.request

## Evidence

## Final Summary


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
