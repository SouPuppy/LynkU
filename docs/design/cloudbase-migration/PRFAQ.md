# CloudBase Migration — PR/FAQ

## Problem

Lucky BBS currently has a backend designed for FastAPI + PostgreSQL + WebSocket,
but the project has pivoted to WeChat Cloud Development (CloudBase). The
existing design documents, tickets, and frontend code all assume:

- A Python FastAPI backend with JWT authentication
- PostgreSQL with SQLAlchemy ORM, TSVECTOR full-text search, Alembic migrations
- A WebSocket server for real-time messaging with session management
- A REST API client (`mp-api-client`) and WebSocket client (`mp-ws-client`) in the frontend
- Mock data in static JSON files for prototype development

None of this exists yet (no backend code written), but the design artifacts and
tickets (FEAT-001 through FEAT-009) are wrong — they describe a system that
will never be built.

**The entire backend layer needs to be redesigned for CloudBase**, the frontend
data access layer needs to be rewritten from REST/WebSocket to `wx.cloud` SDK,
and mock data needs to be replaced with live database access.

## Solution

**Complete architectural migration to WeChat CloudBase.** Replace the deleted
backend modules with cloud functions + document database, rewrite the frontend
service layer around `wx.cloud` SDK, and use `db.collection().watch()` for
real-time messaging.

### What changes

| Layer | Before (deleted) | After (CloudBase) |
|-------|-----------------|-------------------|
| Backend compute | FastAPI + Uvicorn | 6 cloud functions (Node.js): login, posts, comments, messages, categories, users |
| Backend auth | Manual wx.login + JWT encode/decode + dependency injection | `context.OPENID` auto-injected by CloudBase runtime |
| Database | PostgreSQL + SQLAlchemy 2.0 + Alembic | CloudBase document DB (JSON), 5 collections: users, posts, comments, messages, categories |
| Search | PostgreSQL TSVECTOR + GIN index | `db.RegExp()` keyword match (MVP); search index collection if needed |
| Real-time | WebSocket server + session manager | `db.collection().watch()` — client-side reactive subscription |
| File storage | N/A (out of scope) | Cloud Storage with CDN (ready when file upload enters scope) |
| Frontend API | `wx.request` wrapper + JWT injection | `wx.cloud.database()` for reads, `wx.cloud.callFunction()` for writes |
| Frontend WS | `wx.connectSocket` + state machine + heartbeat | `db.watch()` + onError fallback to polling |
| Frontend auth | JWT storage + refresh + 401 interception | Zero code — `wx.cloud.init()` handles identity |
| Mock data | Static JSON files in `mock/` | Removed. All data from live database. |

### What stays

- Frontend page structure (forum feed, post detail, create post, profile, chat)
- Frontend component tree (post-card, comment-item, chat-bubble, avatar, empty, error, nav-bar, skeleton)
- Skyline + Glass-Easel + TypeScript stack
- WeChat Native (no Taro/Uni-app)
- CSS variable theme system
- Subpackage strategy (chat = independent subpackage)

### Architecture (new)

```
WeChat Mini-Program (TypeScript, Skyline, Glass-Easel)
       │
       ├── mp-pages (forums, posts, chat, profile)
       │       │
       │       ├── mp-components (post-card, comment-item, chat-bubble, avatar, ...)
       │       └── mp-utils (formatTime, storage, debounce, LoadState)
       │
       ├── mp-services (typed data access boundary)
       │       │
       │       ├── Direct DB reads (posts list, comments, categories, user profiles)
       │       └── Cloud function calls (create post, send message, update profile)
       │
       └── mp-watch (real-time push subscriptions)
               │
               └── db.collection().watch() → posts, comments, messages

CloudBase Backend:
       │
       ├── cf-login     → db-users
       ├── cf-posts     → db-posts, db-categories, ext-wechat
       ├── cf-comments  → db-comments, db-posts
       ├── cf-messages  → db-messages, db-users
       ├── cf-categories → db-categories
       ├── cf-users     → db-users, db-posts, db-comments
       └── cf-utils     (shared layer: sensitive word filter, validation)
```

### Scope

| In Scope | Out of Scope (MVP) |
|----------|-------------------|
| CloudBase environment setup + initialization | Image/file uploads in posts/messages |
| 5 database collections with indexes + permissions | Push notifications (template messages) |
| 6 cloud functions with action-based routing | Admin dashboard UI |
| cf-utils shared layer (sensitive words, validation) | AI content moderation (WeChat msgSecCheck optional) |
| Frontend services/ layer (typed CloudBase SDK wrapper) | User blocking/reporting |
| watch()-based real-time messaging (posts, comments, chat) | Group chats |
| Polling fallback when watch() fails | Message read receipts (deferred) |
| Category-based post listing with cursor pagination | Online presence indicators |
| Nested comments (2 levels deep, enforced by cloud function) | Rich text editor |
| Keyword search via RegExp | Full-text search index |
| WeChat-native auth via context.OPENID | UNNC email/SSO verification |
| Sensitive word filtering on all user-generated content | Rate limiting persistence across cold starts |
| LoadState coverage (loading/empty/error/loaded) on all views | Offline write queue |
| Removal of all mock data | E2E tests |
| Removal of old design artifacts referencing FastAPI/PostgreSQL | CI/CD pipeline |

## Customer Quote

> "I can now build the entire backend without leaving WeChat DevTools. One click
> to deploy a cloud function, one click to create a database index. No server,
> no Docker, no PostgreSQL config. I just write business logic and it works."
> — Lucky Developer

## FAQ

**Q: Why CloudBase instead of keeping the FastAPI design?**
CloudBase eliminates server ops entirely. No PostgreSQL to manage, no WebSocket
server to scale, no JWT token system to build and secure. For a student-run
non-profit BBS at UNNC scale (~10k users), this is the difference between
"someone needs to be on call" and "it just runs." Cost: ~50 RMB/month vs a
cloud server at 100-200 RMB/month + ops time.

**Q: Doesn't document DB mean we lose relational integrity?**
Yes, and that's acceptable for this use case. Posts and comments don't need
ACID transactions across collections. The critical path (message delivery) uses
idempotency via unique `msg_id` rather than transactional guarantees. Category
`post_count` is eventually consistent — a comment count being off by 1 for a
few seconds is not a problem for a campus BBS.

**Q: How does real-time messaging work without WebSocket?**
`db.collection().watch()` provides server-push to the client. When a new message
is written to the `messages` collection, the recipient's watch subscription
receives it in near-real-time (1-2s latency). The database itself is the message
queue — offline messages are just unread documents. If watch fails (quota
exceeded, network issue), the client falls back to polling the cloud function
every 5 seconds.

**Q: What about full-text search without PostgreSQL TSVECTOR?**
`db.RegExp()` provides basic keyword matching on title and content. For a campus
BBS with ~10k posts, this is adequate. Results are ranked by `created_at` recency.
If search quality becomes an issue, the migration path is: (1) create a search
index collection where a cloud function tokenizes and indexes post content on
write, (2) integrate an external search service. Neither is needed for MVP.

**Q: How does auth work now?**
`wx.cloud.init()` in `app.ts`. Every cloud function automatically receives
`context.OPENID`. No login API call, no JWT storage, no token refresh, no 401
handling. User document is created automatically on first cloud function call.
This is simpler AND more secure — the trust boundary is the WeChat runtime, not
our JWT implementation.

**Q: What happens to the existing tickets (FEAT-001 to FEAT-009)?**
They describe the old FastAPI architecture and are obsolete. They will be
replaced with new tickets (FEAT-010 to FEAT-016) that reflect the CloudBase
architecture. EPIC-001 (the original Lucky BBS epic) remains as the parent
epic, with scope updated.

**Q: Does this change the license or open-source status?**
No. AGPLv3 still applies. CloudBase is a platform, not a dependency — the code
is still ours. Anyone can fork the project and deploy to their own CloudBase
environment.

**Q: What's the migration sequence?**
Bottom-up: (1) CloudBase environment + database collections, (2) cloud functions
(login → posts → comments → messages → categories → users), (3) frontend service
layer, (4) frontend pages wired to real data (mock removed), (5) real-time watch
integration, (6) cleanup of old artifacts.

## Design Documents

- Research Report: `docs/design/cloudbase-migration/research_report.json`
- Topology Model: `docs/design/cloudbase-migration/topology_model.json`
- Module Specs: `docs/design/cloudbase-migration/module_specs.json`
- Audit Report: `docs/design/cloudbase-migration/audit_report.json` — **verdict: PROCEED** (9/9 predicates PASS, 0 blockers)
