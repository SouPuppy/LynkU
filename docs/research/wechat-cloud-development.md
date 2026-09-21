# WeChat Cloud Development (CloudBase) — Deep Research Report

> Target: Migrate Lucky BBS from FastAPI + PostgreSQL to WeChat Cloud Development (CloudBase).
> Date: 2026-07-21
> Related: [[lucky-bbs]], [[frontend-tech-stack]]

## Problem Domain

Lucky is a campus BBS + private messaging WeChat mini-program for UNNC (~10k
students). Currently designed with a FastAPI + PostgreSQL backend, the user
wants to eliminate the self-hosted backend entirely and adopt WeChat Cloud
Development (CloudBase) — a serverless BaaS that provides database, storage,
cloud functions, and native WeChat auth integration, all inside the WeChat
ecosystem.

Key constraints:
- Single WeChat mini-program frontend (already scaffolded, TypeScript + Skyline)
- ~10k target users, low-to-moderate concurrency
- Category-based forum with posts, nested comments (2 levels), full-text search
- Real-time 1:1 private messaging
- WeChat-native login, no separate accounts
- Open-source (AGPLv3), non-profit, minimal ops burden

## What Is CloudBase

WeChat Cloud Development (CloudBase / TCB) is a joint product of Tencent Cloud
and the WeChat team. It is a **serverless backend-as-a-service** tightly
integrated into the WeChat mini-program runtime.

Source: Official WeChat Open Docs (`developers.weixin.qq.com`, verified 2026-07-21).

### Core Components

| Component | What it replaces | Description |
|-----------|-----------------|-------------|
| Cloud Database | PostgreSQL | JSON document DB (MongoDB-compatible) AND MySQL. Two modes: document-type (free-form JSON) and data model (MySQL-backed, schema-defined). Auto-index, auto-scale. |
| Cloud Functions | FastAPI services | Node.js serverless functions, auto-scale, native WeChat auth context. Also supports HTTP triggers for external access, always-on instances (paid). |
| Cloud Storage | File server | Object storage with CDN, image processing, ACL. Direct upload/download from mini-program frontend. |
| Cloud Call | WeChat API integration | Call WeChat open APIs (payment, user info, messaging, etc.) without access_token, signature, or certificate management. Runs on WeChat private protocol. |

### Extended Capabilities (from official docs)

| Capability | Relevance to Lucky |
|-----------|-------------------|
| **Workflow (工作流)** | Visual orchestration for backend logic. Could replace simple cloud functions (e.g., content moderation pipeline: receive post → filter check → flag or publish). Lower code, easier to maintain. |
| **Data Model (数据模型)** | Visual schema designer + MySQL backend. Alternative to raw document DB. If relational integrity matters more than flexibility (e.g., payment records), use this. For BBS content (posts/comments), document DB is better. |
| **Environment Sharing (环境共享)** | One CloudBase environment can serve multiple mini-programs/official accounts/web apps. If Lucky later needs a companion official-account web app or admin panel, reuse the same backend. |
| **CMS (内容管理)** | Built-in visual CMS for managing text, markdown, images stored in Cloud Database. Could serve as Lucky's admin panel for post moderation — zero extra code. |
| **Cloud Backend (云后台)** | Ready-made ops dashboard: user management, payment management, official account management. Out-of-box admin for user/order operations. |
| **AI Integration** | Built-in model access (LLM, image generation, agents). Could use for: auto-moderation, content summarization, AI-assisted search. Agent UI component available for mini-program. |
| **Static Website Hosting** | Deploy admin web panels, documentation, or landing pages. Custom domain support with anti-abuse protection. |
| **HTTP Cloud Functions** | Expose cloud functions as HTTP endpoints (for non-WeChat clients, webhooks, third-party callbacks). |
| **Local Debugging** | Debug cloud functions locally before deployment. Breakpoints, log inspection in WeChat DevTools. |
| **Cloud Templates** | Pre-built for: WeChat Pay, user info, mini-program code/link, messaging, e-commerce. May accelerate payment or notification features. |
| **Scheduled Triggers** | Cron-based cloud function execution. For: daily cleanup, statistics aggregation, expired data pruning. |
| **Real-time Data Push (watch)** | Database change-stream subscription from client SDK. Replaces WebSocket for real-time updates. |

### Key Architecture Difference: Document DB vs MySQL

CloudBase offers TWO database modes. For Lucky:

| Decision | Choice | Why |
|----------|--------|-----|
| Posts + Comments + Messages | Document DB | Flexible schema, fast iteration, natural fit for content |
| Users + Categories | Document DB | Simple key-value, denormalized counts |
| Payment records (future) | Data Model (MySQL) | Relational integrity for financial data |
| Admin/moderation queue | Data Model or Document DB | Either works; CMS covers most needs |

## Architecture Comparison

### Current Design (FastAPI + PostgreSQL)

```
WeChat Mini-Program (mp-pages, mp-components)
       │
       ├── REST (JWT) ─── mp-api-client ──→ FastAPI (be-routes)
       │                                          │
       │                                          ├── be-auth-service ──→ WeChat API
       │                                          ├── be-post-service ──→ be-post-repo ──→ PostgreSQL
       │                                          ├── be-comment-service ──→ be-comment-repo ──→ PostgreSQL
       │                                          ├── be-message-service ──→ be-message-repo ──→ PostgreSQL
       │                                          └── be-category-service ──→ be-category-repo ──→ PostgreSQL
       │
       └── WebSocket ── mp-ws-client ──→ be-ws-handler
                                              │
                                              ├── be-session-manager (online tracking)
                                              └── be-message-service (offline delivery)
```

### CloudBase Migration Target

```
WeChat Mini-Program (mp-pages, mp-components)
       │
       ├── wx.cloud.callFunction() ──→ Cloud Functions (Node.js)
       │                                    │
       │                                    ├── login (WeChat auth, returns JWT)
       │                                    ├── posts (CRUD, search, pagination)
       │                                    ├── comments (CRUD, nesting)
       │                                    ├── messages (send, conversation list)
       │                                    └── categories (list, admin CRUD)
       │
       ├── wx.cloud.database() ──→ Cloud Database (JSON documents)
       │                              ├── users collection
       │                              ├── categories collection
       │                              ├── posts collection
       │                              ├── comments collection
       │                              └── messages collection
       │
       ├── db.collection().watch() ──→ Real-time push (replaces WebSocket)
       │
       └── wx.cloud.uploadFile() ──→ Cloud Storage (avatars, future file uploads)
```

## Deep Dive: Mapping Each Backend Module

### 1. Authentication — be-auth-service + wechat-api

**CloudBase maps this almost entirely.**

In a cloud function, `context.OPENID` is automatically populated — no need to
call `jscode2session` manually. The WeChat runtime injects the user's openid
into every cloud function invocation. This eliminates:

- The `wechat-api` gateway module entirely
- The manual code exchange in `be-auth-service.login_with_wechat()`
- JWT signing infrastructure (cloud functions don't need it — the openid is
  trusted at the platform level)

**Remaining concern**: CloudBase's native auth is openid-based, not JWT-based.
For a mini-program-only app, this is fine — every `wx.cloud.callFunction()` is
implicitly authenticated. When users need a session token for WebSocket-like
features, cloud function results can carry a custom token, but it's optional.

**Recommendation**: Drop JWT entirely. Use cloud function's `context.OPENID` as
the user identity. For admin operations, store role in the user document and
check it inside the cloud function. This removes `be-auth-service`, `be-user-repo`,
and `wechat-api` as separate modules.

### 2. Posts — be-post-service + be-post-repo

**Cloud Database replaces PostgreSQL for post storage.**

Data model (JSON document):

```javascript
// posts collection
{
  _id: "auto-generated",
  _openid: "user-wechat-openid",  // auto-set by CloudBase
  title: "Course selection tips?",
  content: "plain text content...",
  category_id: "cat-academic",
  status: "published",           // published | flagged | hidden | deleted
  view_count: 142,
  comment_count: 8,
  created_at: serverDate(),
  updated_at: serverDate(),
  // CloudBase auto-indexes: _id, _openid
  // Manual indexes needed: category_id+status+created_at (compound)
}
```

**Query mapping**:

| Old (SQLAlchemy) | New (CloudBase wx.cloud.database()) |
|------------------|-------------------------------------|
| `list_posts(category_id, cursor, limit)` | `db.collection('posts').where({category_id, status:'published'}).orderBy('created_at','desc').skip(N).limit(20).get()` |
| `search_posts(query, cursor, limit)` | CloudBase does NOT have PostgreSQL TSVECTOR. Use `db.RegExp()` for simple keyword match, or `db.collection('posts').where({title: db.RegExp({regexp: query, options: 'i'})})`. For serious search, use a cloud function with a separate search index collection, or accept LIKE-style matching for MVP scale (~10k posts). |
| `create_post()` with sensitive word check | Cloud function: check content against word list in function code or a `sensitive_words` collection, set `status:'flagged'` if match, then `db.collection('posts').add({data})` |
| `field()` projection | `db.collection('posts').field({title:true, content:true, ...})` — same idea |

**Key differences**:

- CloudBase uses `_openid` for ownership. Set collection permission to "all
  users can read, only creator can write". Cloud functions bypass permissions,
  so admin/moderation logic goes in cloud functions.
- No joins. To include author info in post listings, either: (a) denormalize
  author nickname and avatar into the post document at creation time, or (b)
  do a second `users` lookup after fetching posts. For a BBS, denormalization
  is the standard approach (author data is infrequently updated).
- Cursor-based pagination: CloudBase supports `skip()` + `limit()` (offset
  pagination). For cursor pagination equivalent, use `where({_id: _.lt(lastId)})`
  combined with `orderBy('_id', 'desc')`.
- `serverDate()` replaces `datetime.utcnow()` — uses server time, not client time.

### 3. Comments — be-comment-service + be-comment-repo

**Cloud Database with self-referencing parent_id.**

```javascript
// comments collection
{
  _id: "auto-generated",
  _openid: "author-openid",
  post_id: "post-xxx",
  parent_id: null,             // null = top-level, otherwise reply-target
  content: "Great tips!",
  depth: 0,                    // 0 or 1 (max 2 levels: post → comment → reply)
  status: "published",
  created_at: serverDate()
}
```

**Nested query**: Fetch all comments for a post in one query:
```javascript
db.collection('comments')
  .where({ post_id: postId, status: 'published' })
  .orderBy('created_at', 'asc')
  .get()
```
Then build the tree in-memory on the client (same as the original `be-comment-repo`
approach — flat query + in-memory tree).

### 4. Private Messaging — be-message-service + be-ws-handler + be-session-manager

**This is the hardest module to migrate.** The current design uses WebSocket
for real-time delivery. CloudBase does NOT natively support WebSocket.

**Replacement options**:

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **A: Database watch()** | `db.collection('messages').watch({onChange})` | No cloud function needed, real-time push built into SDK | Watch has connection limits per environment. Chatty collections (messages) may hit rate limits on high-frequency push. |
| **B: Polling with cloud function** | Client polls a cloud function every 3-5 seconds | Simple, reliable, no watch limits | Higher call count (cost). Latency 3-5s. Feels sluggish. |
| **C: Hybrid** | watch() for active conversations, cloud function for history | Best UX per cost | More complex client logic |

**Recommendation for MVP**: Option A (watch).

CloudBase `watch()` provides real-time data push directly to the client. For
messaging:

```javascript
// Client subscribes to messages where user is participant
const watcher = db.collection('messages')
  .where(_.or([
    { from: myOpenid, to: otherOpenid },
    { from: otherOpenid, to: myOpenid }
  ]))
  .orderBy('created_at', 'asc')
  .watch({
    onChange: (snapshot) => {
      // snapshot.docChanges has new messages
      // snapshot.docs is the full conversation
      this.setData({ messages: snapshot.docs })
    },
    onError: (err) => console.error('watch error', err)
  })

// Remember: watcher.close() on page unload
```

**Online presence**: No WebSocket session manager. Alternatives:
- Heartbeat collection: each user updates a `presence` document every 30s via
  `setInterval` calling a cloud function. Other users `watch()` the presence
  document. Simple but adds ~2 cloud function calls per online user per minute.
- Accept absence of real-time presence indicators for MVP. Show "last seen"
  timestamp instead, updated on each cloud function call.

**Offline delivery**: With CloudBase, every message is persisted to the
database. The `watch()` subscription only fires when the client is connected.
When the user opens the chat, the full history loads via a cloud function
query. No separate "offline queue" needed — the database IS the queue.

**Message status**: Use document fields (`status: sent/delivered/read`).
Client updates `status` via `db.collection('messages').doc(msgId).update()`.

### 5. Categories — be-category-service + be-category-repo

```javascript
// categories collection
{
  _id: "cat-academic",
  name: "Academic",
  description: "Course discussion, exam prep, study groups",
  sort_order: 1,
  post_count: 42,
  status: "active"
}
```

Collection permission: "all users can read, only admin can write" (admin check
in cloud function). Simple list query, no pagination needed for <50 categories.

### 6. Real-time Features (watch) — replaces WebSocket

CloudBase `watch()` is the key enabler for real-time features in this
WebSocket-less architecture:

| Feature | Implementation |
|---------|---------------|
| New posts in category | `watch()` on `posts` collection filtered by category |
| New comments on post | `watch()` on `comments` collection filtered by post_id |
| New messages in conversation | `watch()` on `messages` collection filtered by conversation pair |
| Online presence | `watch()` on `presence` collection (if implemented) |

**Limitations**:
- Watch does NOT support `aggregate()` — can't watch aggregation results
- Watch has per-connection subscription limits (environment-dependent, check
  console quotas)
- High-frequency writes (many per second) get batched/throttled by watch
- Network changes (WiFi to 4G) cause brief disconnection; SDK auto-reconnects

For a campus BBS with ~10k users and low concurrent activity, these limits are
far above expected usage.

## Frontend Changes Required

### Initialization

```javascript
// app.ts — already using wx.cloud
App({
  onLaunch() {
    wx.cloud.init({
      env: 'lucky-xxxxx',     // CloudBase environment ID
      traceUser: true          // track users in CloudBase console
    })
  }
})
```

### API Client Refactor (mp-api-client)

The current `mp-api-client` wraps `wx.request` with JWT injection. After
migration, two distinct call patterns:

1. **Direct DB access** (read-only, permission-allowed): `wx.cloud.database()`
   — used for browsing posts, comments, categories.
2. **Cloud function calls** (writes, admin ops, complex queries):
   `wx.cloud.callFunction({name: 'posts', data: {action: 'create', ...}})`.

The API client can wrap both behind a clean interface:

```typescript
// Simplified mp-api-client
export const api = {
  // Direct DB reads (fast, no cloud function invocation cost)
  posts: {
    list(params: ListPostsParams) {
      return db.collection('posts')
        .where(buildWhere(params))
        .orderBy('created_at', 'desc')
        .skip(params.offset)
        .limit(params.limit)
        .get()
    }
  },
  // Cloud function calls (writes, logic)
  posts: {
    async create(data: CreatePostData) {
      const res = await wx.cloud.callFunction({
        name: 'posts',
        data: { action: 'create', ...data }
      })
      return res.result
    }
  }
}
```

### WebSocket Client (mp-ws-client) — Removal

The entire `mp-ws-client` module is replaced by `db.collection().watch()`.
The connection state machine (idle → connecting → connected → reconnecting →
failed) maps to the watch lifecycle (establish → onChange → onError →
auto-reconnect).

### Auth Module (mp-auth) — Simplified

Current flow: `wx.login()` → get code → POST /api/auth/login → receive JWT →
store locally → inject on every request.

CloudBase flow:
1. `wx.cloud.init()` is called once in `app.ts`
2. Every `wx.cloud.callFunction()` automatically carries the user's identity
3. In cloud functions, `cloud.getWXContext().OPENID` gives the caller's identity
4. No JWT, no token storage, no token refresh logic

**Remaining auth logic**:
- On first login, a cloud function creates a user document if it doesn't exist
- User profile (nickname, avatar) is fetched via `wx.getUserProfile()` and
  synced to the `users` collection

## Cloud Function Design

### Recommended Structure

```
cloudfunctions/
├── login/                # User bootstrap: create/find user, return profile
│   ├── index.js
│   └── package.json
├── posts/                # Post CRUD + search + moderation
│   ├── index.js          # routes by event.action: create|list|search|delete|flag
│   └── package.json
├── comments/             # Comment CRUD
│   ├── index.js
│   └── package.json
├── messages/             # Message send + conversation list + unread count
│   ├── index.js
│   └── package.json
├── categories/           # Category list + admin CRUD
│   ├── index.js
│   └── package.json
└── utils/                # Shared: sensitive word filter, validation helpers
    ├── filter.js
    └── index.js
```

Each cloud function acts as a router, dispatching by `event.action`:

```javascript
// cloudfunctions/posts/index.js
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async (event, context) => {
  const { action } = event
  const openid = cloud.getWXContext().OPENID

  switch (action) {
    case 'create': return createPost(openid, event.data, db)
    case 'list':   return listPosts(event.params, db)
    case 'search': return searchPosts(event.query, db)
    case 'delete': return deletePost(openid, event.postId, db)
    default:       return { error: 'UNKNOWN_ACTION' }
  }
}
```

### Cold Start Mitigation

Cloud functions have a cold-start penalty (100-800ms). For latency-sensitive
paths (login):

1. Move `require('wx-server-sdk')` and `cloud.init()` to module scope (runs
   once, reused across warm invocations)
2. Increase memory allocation to 512MB (more CPU proportionally)
3. For the login function specifically, enable minimum instances (paid feature)
4. Use `npm install --production` to minimize deployment package size

For Lucky's scale, cold starts are acceptable. A user browsing posts won't
notice 300ms on the first load after inactivity.

### Scheduled Tasks (Timer Triggers)

CloudBase supports cron-triggered cloud functions:

```json
// cloudfunctions/cleanup/config.json
{
  "triggers": [{
    "name": "daily-cleanup",
    "type": "timer",
    "config": "0 3 * * * *"   // daily at 3am
  }]
}
```

Use for:
- Cleaning up expired presence documents
- Aggregating daily statistics
- Pruning soft-deleted posts beyond retention period

## Database Permission Model

CloudBase has four permission modes per collection:

| Mode | When to use for Lucky |
|------|----------------------|
| **All users read, only creator write** | `posts`, `comments` — users can read all, write only their own |
| **Only creator can read/write** | `messages` — private conversations, each user sees only their own |
| **Admin only read/write** | `categories` — frontend reads via cloud function or "all read" with cloud function enforcing writes |
| **Custom security rules** | `users` — read own or others' public profiles |

**Important**: Cloud functions bypass all permission rules. So sensitive
operations (deleting a post, creating a category) MUST be done in cloud
functions with manual auth checks, not via direct database calls from the
client.

**The `messages` collection challenge**: Messages involve two users. If set to
"only creator can read/write", user A can't read messages FROM user B. Solutions:
- Option A: Store each message as two documents (one per participant) — doubles
  storage but clean permission model
- Option B: Set messages to "admin only" and route ALL message access through
  cloud functions — simpler, at the cost of cloud function invocations for reads
- **Recommendation**: Option B for MVP. Message reads go through cloud functions.
  This is a read-heavy path (~2-3 reads per minute per active user), well within
  free tier.

## Pricing Analysis (UNNC Scale)

### Base tier

| Resource | Free/Base Quota | Monthly Cost |
|----------|----------------|-------------|
| Environment | Free during development (until 2026-12-31 per 2025 policy) | Free |
| Base plan (after launch) | 20万 calls, 2GB storage, 10万 GBs compute | 19.9 RMB/month |
| Extra calls | 0.5 RMB/万次 | Variable |

### Estimated usage for ~10k students

Assume:
- 2,000 DAU (daily active users)
- Each user: browses 5 pages, creates 1 post/week, 3 comments/day, 10 messages/day
- 30 days/month

| Operation | Daily count | Monthly | CloudBase metric |
|-----------|------------|---------|-----------------|
| Page views (direct DB reads) | 10,000 | 300,000 | DB read ops (included in calls) |
| Post creates (cloud function) | 286 | 8,580 | Cloud function calls |
| Comment creates (cloud function) | 6,000 | 180,000 | Cloud function calls |
| Message sends (cloud function) | 20,000 | 600,000 | Cloud function calls |
| Message watch connections | ~500 concurrent | — | Watch connections |
| **Total cloud function calls** | ~26,000/day | ~790,000/month | — |

**Monthly cost projection**:
- Base plan (200,000 calls): 19.9 RMB
- Overage: 590,000 calls × 0.5 RMB/万 = 29.5 RMB
- Storage: 2GB included, likely sufficient for text-heavy BBS
- **Total: ~50 RMB/month** (within range for a non-profit student project)

If DAU is lower (500-1000), the base 19.9 RMB plan covers everything.

## Limitations and Trade-offs

### What CloudBase CANNOT do (and workarounds)

| Limitation | Impact on Lucky | Workaround |
|-----------|----------------|-----------|
| No full-text search (no PostgreSQL TSVECTOR) | Post search is basic keyword match | Use `db.RegExp()` for MVP. Add Elasticsearch/Meilisearch in cloud function if needed later. Or use a reverse-index collection. |
| No WebSocket | No real-time push via persistent connection | Use `watch()` for near-real-time. Accept 1-2s latency on database push events. |
| Cloud functions: 60s timeout max | Long-running operations fail | Split into multiple functions. Not an issue for BBS CRUD (all ops <1s). |
| No transactions across collections | Cross-collection atomicity not guaranteed | Use single-collection transactions (`db.runTransaction`). CloudBase supports transactions within a single collection for up to 100 operations. For Lucky: post create + category post_count increment can be done in a cloud function with sequential writes (acceptable for a BBS — counters are eventually consistent). |
| watch() does not support aggregate() | Can't watch computed/aggregated data | Run aggregation in cloud function, write results to a cache collection, watch the cache. |
| Cloud function cold starts | Latency spikes (100-800ms) | Module-scope init, appropriate memory, minimum instances for critical paths. |
| No PostgreSQL-style relations/joins | Data modeling requires denormalization or N+1 queries | Denormalize read-heavy data (author info in post). For complex queries, cloud functions do multi-step lookups. |
| Node.js only for cloud functions | No Python | Acceptable — business logic is simple CRUD + sensitive word filtering. If complex logic is needed, Node.js handles it fine. |

### What CloudBase ADDS (previously unavailable)

| Capability | Description |
|-----------|-------------|
| Zero-ops database | No PostgreSQL to manage, backup, patch, or scale |
| Native WeChat auth | No JWT flow to build. `context.OPENID` guaranteed by the runtime |
| Real-time watch built-in | No WebSocket server to manage. `watch()` is client-side SDK |
| CDN storage | File uploads get CDN for free. No S3/COS setup |
| AI Toolkit (2025) | MCP protocol integration with Claude Code, Cursor, etc. for AI-assisted development |
| Console management | Visual database browser, function logs, usage metrics. No need to build admin tools |
| Scheduled triggers | Cron-based cloud functions for cleanup, stats |
| Static hosting | Could host a web admin panel or documentation site |

## Migration Impact on Existing Tickets

Current tickets (FEAT-001 to FEAT-009) need revision:

| Ticket | Old Scope | CloudBase Impact |
|--------|-----------|-----------------|
| FEAT-001 | Backend core + DB models + schema | **REPLACE**: Cloud DB collections + cloud function scaffolding instead of SQLAlchemy + FastAPI |
| FEAT-002 | WeChat auth (login + JWT) | **SIMPLIFY**: Drop JWT entirely. Use cloud function `context.OPENID`. User auto-creation on first cloud function call. |
| FEAT-003 | Category + Post CRUD | **REMAP**: Cloud DB direct reads, cloud functions for writes. No SQLAlchemy queries. |
| FEAT-004 | Comments with threading | **REMAP**: Cloud DB nested model, flat query + client-side tree |
| FEAT-005 | WebSocket messaging | **REPLACE**: Drop WebSocket entirely. Use `db.watch()` for real-time + cloud functions for send. |
| FEAT-006 | Frontend nav + auth flow | **SIMPLIFY**: No JWT storage. `wx.cloud.init()` handles identity. |
| FEAT-007 | Frontend post browsing | **REMAP**: Use `wx.cloud.database()` directly for reads instead of REST API |
| FEAT-008 | Frontend messaging UI | **REMAP**: Use `db.watch()` instead of WebSocket client. Remove mp-ws-client. |
| FEAT-009 | Backend env config | **REMAP**: CloudBase environment ID config instead of backend URL |

## Recommendations

### 1. Adopt CloudBase for MVP

The architecture is a good fit for Lucky's scale and requirements. The
serverless model eliminates the most complex parts of the current design:
WebSocket session management, JWT infrastructure, PostgreSQL operations,
and server deployment.

### 2. Key architectural decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Auth strategy | Drop JWT, use `context.OPENID` | Cloud functions are implicitly authenticated. No token management needed. |
| Database design | Denormalize author info into posts/comments | Avoids N+1 queries. Author data changes rarely. |
| Real-time messaging | `db.watch()` on messages collection | Simpler than WebSocket. Sufficient for low-frequency chat. |
| Message access control | All message reads/writes through cloud functions | Cleaner than dual-document pattern. Call volume acceptable. |
| Full-text search | `db.RegExp()` for MVP | Adequate for <10k posts. Swap to search index collection if needed. |
| Online presence | "Last seen" timestamp only for MVP | Skip real-time presence. Add watch-based heartbeat later if users request it. |
| Admin operations | Cloud function with role check | Simple. No separate admin server. |

### 3. What to keep from the current design

- Frontend component tree (`mp-pages`, `mp-components`) — stays largely unchanged
- Data model shapes (User, Post, Comment, Message, Category) — same logical
  structure, stored as Cloud DB documents instead of SQL rows
- Sensitive word filtering logic — moves from `be-post-service` into a cloud
  function utility, or into a Workflow pipeline
- Comment depth limit (2 levels) — enforced in cloud function, same logic
- Cursor-based pagination concept — implemented with `_id` comparison instead
  of `created_at` base64 cursor

### 4. Official-doc opportunities for Lucky

Capabilities confirmed in the WeChat official docs that fit Lucky well:

- **CMS as admin panel**: CloudBase CMS can manage posts, comments, and users
  visually. Zero admin UI to build for MVP — use CMS for content moderation
  (hide flagged posts, review reports). Built-in, free, no code.

- **Workflow for moderation pipeline**: Instead of coding moderation logic in a
  cloud function, use Workflow's visual editor: post submission → sensitive word
  check → branch (clean → publish / flagged → queue for review). Easier to
  adjust filtering rules without redeploying code.

- **AI for content moderation**: CloudBase AI integration can call LLM for
  semantic content review (not just keyword matching). e.g., "Is this post
  spam?" → flag. More accurate than simple word lists. Use `cloud.openapi.*`
  for image moderation on uploaded content.

- **Environment sharing for future expansion**: If Lucky later gets a companion
  official account web app (for alumni, for PC access), share the same
  CloudBase environment. No migration, no sync.

- **Static hosting for project site**: Deploy Lucky's documentation/landing page
  as a static site on CloudBase. Custom domain. Free tier covers low traffic.

### 5. What to delete entirely

- `be-routes` (FastAPI route handlers) — replaced by cloud functions
- `be-ws-handler` (WebSocket server) — replaced by `watch()`
- `be-session-manager` (WebSocket session tracking) — no WebSocket server
- `be-core` (database pool, app factory) — CloudBase manages infra
- `be-schemas` (Pydantic models) — validation moves to cloud function code
- `be-models` (SQLAlchemy ORM) — replaced by Cloud DB documents
- `be-user-repo`, `be-post-repo`, `be-comment-repo`, `be-message-repo`,
  `be-category-repo` — replaced by direct Cloud DB operations
- `wechat-api` (jscode2session calls) — handled by CloudBase runtime
- `mp-ws-client` (WebSocket client) — replaced by `db.watch()`
- `mp-api-client` (REST client) — replaced by `wx.cloud` SDK
- JWT token management in `mp-auth` — replaced by CloudBase identity

### 6. Migration sequence

```
Phase 1: CloudBase env setup + login cloud function + user collection
         → replaces FEAT-001 (be-core), FEAT-002 (auth), FEAT-009 (env config)

Phase 2: Categories + Posts cloud functions + direct DB reads
         → replaces FEAT-003 (post/category CRUD), FEAT-006 (frontend nav)

Phase 3: Comments cloud function + client-side tree rendering
         → replaces FEAT-004 (comments), FEAT-007 (post detail view)

Phase 4: Messages cloud function + watch() for real-time chat
         → replaces FEAT-005 (messaging), FEAT-008 (chat UI)

Phase 5: Remove all backend code, finalize frontend
```

## References

1. **[PRIMARY] WeChat Cloud Development Official Documentation**: https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/basis/getting-started.html — capabilities, APIs, initialization, guides
2. **WeChat Cloud Development Pricing (Official)**: https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/billing/price.html
3. **CloudBase Official Docs (Tencent Cloud)**: https://docs.cloudbase.net/
4. **CloudBase Mini Program Quick Start**: https://docs.cloudbase.net/en/quick-start/frameworks/wechat-miniprogram
5. **CloudBase Database Watch (real-time push)**: https://docs.cloudbase.net/recipes/add-realtime-notifications-database-watch
6. **CloudBase Cold Start Optimization**: https://docs.cloudbase.net/recipes/optimize-cloud-function-wechat-miniprogram
7. **CloudBase Database in WeChat Mini Program**: https://docs.cloudbase.net/recipes/add-database-wechat-miniprogram
8. **CloudBase AI Toolkit (MCP)**: https://cloud.tencent.cn/developer/article/2552074
9. **CloudBase E-Commerce Full-Stack Tutorial**: https://cloud.tencent.cn/developer/tutorial/practice/1158
10. **CloudBase Fundamentals (Cool-Coding OSS)**: https://github.com/echo-cool-coding/cool-coding/blob/main/docs/framework/wechatminiprogram/12-mini-program-cloud-development/0-cloud-development-fundamental-concepts.mdx
