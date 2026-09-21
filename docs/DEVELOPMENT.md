# LynkU Development Guide

## Prerequisites

- Node.js 24.21.x for local tooling and CI (cloud runtime is configured separately)
- WeChat DevTools, current stable version
- A Mini Program AppID and CloudBase environment
- WeChat DevTools CLI for the new AppID's cloud environment; `tcb` only when its logged-in account can access that same environment

Run local checks after installing development dependencies:

```bash
npm run setup
```

## Runtime Configuration

Edit public settings only in `config/project.json`, then run `npm run configure`. This synchronizes `apps/miniprogram/config.ts`, `project.config.json` and `cloudbaserc.json`; `npm run check` detects drift. Open the repository root in WeChat DevTools; the project configuration points at `apps/miniprogram/` and built `dist/cloudfunctions/`. Personal DevTools overrides belong in `project.private.config.json`; that file is ignored by Git. Moving the source root does not change page URLs or subpackage routes. Never put secrets in the public manifest.

The application authenticates with the server-provided `OPENID`. There is no client JWT and no separate login cloud function. `users?action=ensure` creates or retrieves the user profile.

Startup automatically calls `ensure`; the login page joins the same in-flight request. Unverified WeChat accounts appear as guests, and school email verification upgrades the same account. Existing account IDs, ownership, roles and verification remain intact. A failed identity request allows public browsing with a retry entry. Clearing the local session cancels its pending results and returns to the feed; it does not delete the account or revoke verification. The next application launch restores WeChat identity. No test nickname or email prefix is an authorization bypass.

## Database

Create these collections in the CloudBase console. Content and identity collections must be readable and writable only by administrators/cloud functions; public clients receive sanitized DTOs from cloud functions.

[`config/cloudbase-schema.json`](../config/cloudbase-schema.json) is the machine-readable source for this table. `npm run check:cloud-schema` verifies its shape and checks every collection referenced by a cloud function is declared; real console state remains an R8 verification step.

| Collection | Client permission | Required indexes |
|---|---|---|
| `users` | Admin only | `_openid` unique |
| `posts` | Admin only | `(status, created_at)`, `(status, category_id, created_at)`, `(status, _openid, anonymous, created_at)` |
| `comments` | Admin only | `(post_id, status, created_at)` |
| `comment_counters` | Admin only | document `_id` is `post_id` |
| `comment_changes` | Admin only | `(post_id, sequence)` unique |
| `notification_outbox` | Admin only | `(status, next_attempt_at)`, `(status, created_at)` |
| `profile_outbox` | Admin only | `(status, next_attempt_at)`, `(status, created_at)` |
| `messages` | Admin only | `(from, created_at)`, `(to, created_at)`, `(to, status)`, `(conversation_id, sync_sequence)` unique |
| `conversation_counters` | Admin only | document `_id` is `conversation_id` |
| `conversation_entries` | Admin only | `(owner_openid, updated_at, _id)`, document `_id` is the owner-scoped conversation key |
| `notifications` | Admin only | `(to, created_at, _id)`, `(to, read, created_at, _id)` |
| `categories` | All users read, admin write | `(status, sort_order)`, `name` unique |
| `drafts` | Admin only | `(_openid, updated_at, _id)` |
| `draft_counters` | Admin only | document `_id` is the hashed owner identifier |
| `email_verifications` | Admin only | document `_id` is the hashed `(openid, email)` verification key |
| `rate_limits` | Admin only | document `_id` is the rate-limit key |

Create the indexes before traffic is enabled. The users `_openid` and categories name unique indexes are also the concurrency boundary for user bootstrap and category creation.

Seed categories by invoking `categories` with `{ "action": "seed" }` as an existing admin. Ordinary users cannot seed or mutate categories.

## Cloud Functions

`messages.getUnreadMessageCount` requires a verified account and counts all incoming unread messages for the runtime identity. The message-tab badge uses this count plus the notification count; it never estimates totals from a conversation page. The `(to, status)` index must be deployed before enabling this query in the cloud environment.

The production function list is defined once in `cloudbaserc.json`; build, verification and both deployment scripts read it:

```text
users posts comments messages categories drafts
```

Post creation requires a stable `request_id` and a boolean `anonymous`. The strict TypeScript creation application resolves category metadata from the database, validates its active state and nonnegative count in the same document-only transaction, and writes the post and published category increment atomically. Anonymous author snapshots are constructed by the application. Duplicate requests return their minimal receipt before applying new-create rate limits; missing documents use SDK `throwOnNotFound: false`, while read faults fail without attempting creation. The response is `{ post: { _id, revision, status }, flagged, status: 'created' | 'duplicate' }`; retrieve post content through the read API. Legacy records require valid fingerprints/revisions and reconciled category counts before deployment. Delete and moderation also use strict status-transition applications.

`apps/cloudfunctions/common/index.js` is the only remaining shared legacy helper source. Function entries import it directly; esbuild bundles its code and local packages into each independent `dist/cloudfunctions/<name>/index.js`. There are no source `utils.js` copies. Each artifact contains its own configuration and exact `wx-server-sdk` dependency declaration. `check:cloud-artifacts` verifies manifest/runtime/configuration, artifact hashes, isolated startup for all six functions and a real message-directory application call using a synthetic SDK boundary. This does not replace real CloudBase execution.

`config/cloud-runtime/package-lock.json` locks the SDK and transitive runtime dependencies. The build generates a matching lockfile for every function package; update the canonical runtime manifest/lock and source SDK declarations together. The locally checked SDK is also installed as a root development dependency for type compatibility checks. Its existing transitive audit findings are recorded in ADR 001; a passing structure check does not mean those findings are resolved.

`apps/cloudfunctions/users/config.json` sets a longer timeout for email verification because the function performs an outbound Mailgun HTTPS request. Keep this above the Mailgun request timeout.

Published comment notifications are first written to `notification_outbox` in the same transaction as the comment counter and change record. The request then attempts delivery; a transaction claim gives each consumer a 30-second lease. Failures return to pending with exponential retry delay, bounded at one hour, and retain a short failure reason. An administrator can invoke `comments` with `{ "action": "drainOutbox" }` to retry up to 50 pending events. R7 must replace this manual recovery path with an authenticated scheduled worker and alerting before production traffic.

Notification reads now use shared strict TypeScript contracts and server applications. `listNotifications` accepts an account/filter-scoped cursor over descending `(created_at, _id)`; the old `before` timestamp is rejected. Responses explicitly map public fields and replace anonymous actor identities. `markNotificationsRead` requires 1–100 explicit notification IDs, always scoped to the authenticated recipient; omitting IDs cannot mark all notifications. Both notification pages acknowledge each displayed page and discard late results after hiding or account changes. The schema manifest declares the new tie-breaker indexes; applying and verifying those indexes in CloudBase remains required before deployment.

Draft CRUD now runs through strict TypeScript applications. Creation requires a stable `request_id`; updating requires `draft_id` and `expected_revision`, and rejects a mixed create/update request. Create/delete and the owner counter commit together using document-only transactions. Missing documents are represented by SDK `throwOnNotFound: false`; database faults propagate, and no transaction scans historical drafts to repair a counter. Before deployment, backfill and reconcile every existing owner's draft counter and positive draft revisions, preserve timestamp fields as database dates, and verify the new listing index. A missing counter represents a new owner only after that migration. Public draft DTOs contain ISO timestamps and omit ownership/request metadata. The client validates responses and session revisions; missing cloud functions no longer trigger the retired local-draft fallback. Editor emergency storage remains responsible for preserving unsaved input.

Automatic post-publication cleanup passes the draft's `expected_revision` to deletion. A mismatch returns `DRAFT_CONFLICT` before deleting or decrementing the counter, preserving changes from another editor. Cleanup intent is persisted per account before attempting deletion; the foreground maintenance cycle retries at most five jobs per run, with exponential backoff capped at 60 seconds. Conflict retires the cleanup job and retains the newer draft. Backgrounding or account changes stop subsequent jobs. If intent cannot be persisted, the editor leaves the cloud draft intact and reports that manual cleanup is needed. An unconfirmed initial draft creation is resolved with its original request before publishing; failure prevents publication, while success records its ID and restricts automatic cleanup to creation revision 1 even if the lookup returns a later edit.

Nickname and avatar changes use the same pattern through `profile_outbox`. The event contains the account and profile version but no copied profile payload; its consumer re-reads the current user record before updating non-anonymous post, comment, and notification snapshots. This prevents a delayed older event from restoring stale display data. An administrator can invoke `users` with `{ "action": "drainProfileOutbox" }` while the scheduler remains pending R7 work.

Deploy with either:

```bash
./scripts/create-and-deploy.sh
./scripts/deploy-functions.sh
```

Both scripts build and verify the same artifacts before deployment. `create-and-deploy.sh` requires an already authenticated CloudBase CLI and stops on failure; `deploy-functions.sh` uses the WeChat upload key and reports failed functions. Neither uploads the source directories. There is no clear-db utility in this repository.

## Architecture

```text
Mini Program pages/components
        |
        v
Features / typed services
        |
        v
Cloud function protocol entries
        |
        v
Business applications + injected persistence adapters
        |
        v
CloudBase collections
```

Posts, comments, notifications, profiles, drafts, and messages are read through cloud functions. This is required so anonymous authorship and ownership identifiers are not exposed by direct reads or database watches. Near-real-time views use cloud-function polling with lifecycle cleanup. Chat uses a server-assigned per-conversation sequence; comments use a server-assigned per-post sequence in `comment_changes`; both merge by document ID and retain a scoped cursor. Do not replace either path with timestamp cursors or recursive full-history polling.

## Project Layout

```text
apps/miniprogram/
  pages/            UI, routes and lifecycle bindings
  features/editor/  injected editor state, save, publish and recovery
  composition/      connect features with current client services
  platform/         WeChat storage and platform capabilities
  components/       reusable Glass-Easel components
  services/         remaining typed access/state/polling migration area
  subpkg-chat/      chat subpackage; main package cannot import its implementation
  typings/          client type declarations; app type derives from app.ts
apps/cloudfunctions/
  common/           single legacy helper source; never deployed alone
  users/ posts/ comments/ messages/ categories/ drafts/
packages/contracts/ shared request/response validation
packages/server/    platform-independent business applications
packages/adapters/  typed CloudBase persistence (messaging and notification reads)
tooling/            build, syntax/schema/config and real dependency graph checks
scripts/            deployment and controlled migration commands
tests/              behavior, integration, artifact and architecture tests
dist/cloudfunctions/ independently uploadable generated bundles
```

See [ADR 001](architecture/decisions/001-project-structure.md) for the official research and boundaries. The editor and messaging adapter are implemented slices; legacy services, comment/category business logic and profile projection ownership remain migration work. Source directory reorganization does not mark R2–R8 complete.

## Verification

`npm run check` runs strict TypeScript checking and JavaScript syntax checks for every cloud function. WeChat DevTools remains the source of truth for WXML/WXSS compilation and device rendering.

## Automatic WeChat identity and school verification

Startup automatically calls `users.ensure`; the login page shares that request.
An unverified WeChat account is displayed as a guest. Failure to obtain identity
is a separate loading/error state with public browsing and retry, not a second
guest login. Internal legacy state names `guest/unverified/verified` remain while
their client migration continues. Anonymous posting is a separate preference.

All visitors can browse published posts, categories, search and comments. Posting,
commenting, drafts, notifications and messaging require server-side school verification.
Private data is not requested for an unverified session. `public_only` narrows public
read permissions; it can never grant ownership or authentication.

Email verification is disabled by default in two places:

- Client: `emailVerificationEnabled` in `config/project.json` is false; run `npm run configure` after changes.
- Server: users requires the environment variable EMAIL_VERIFICATION_ENABLED to
  equal the string true before either sendEmailCode or verifyEmailCode can run.
  Otherwise both return EMAIL_VERIFICATION_UNAVAILABLE before mail/database work.

Existing verified flags are preserved. To restore verification, first restore and
validate Mailgun configuration, then enable the users environment variable, and
finally enable the client flag and publish the client. Cross-AppID account migration is a separate task; old identities must not be reassigned implicitly.
Do not enable only the client flag: the server remains authoritative.

Deploy the changed users, posts, and comments cloud functions before releasing this
client, so guest public-view behavior and paused verification are enforced remotely.
Local tests do not deploy cloud functions or replace WeChat DevTools validation.
In DevTools, check automatic identity restoration, a shared post link, identity
failure and retry, returning to a post after login, unverified message/profile tabs,
and local session clearing followed by restart. Repeat posting/commenting/messaging
with both an unverified account and a previously verified account.

### 会话目录分页

`messages.listConversations` 接受可选 `cursor` 和 `limit`，返回 `conversations`、`hasMore`、`nextCursor`。游标包含 `version: 1`、账号作用域摘要 `scope`、ISO 时间 `updatedAt` 和目录记录 `id`。按 `updated_at desc, _id desc` 排序，每次读取上限加一条以判断是否有下一页；非法或其他账号的游标在查询前拒绝。

这是实时目录，不提供跨请求快照。翻页期间收到新消息的会话可能前移，需要重新进入页面刷新首页；已加载页面按会话标识去重。部署前建立 `(owner_openid, updated_at, _id)` 索引并回填目录。客户端不使用旧消息扫描回退。

### 共享契约的实际构建边界

`packages/contracts/src` 是公共协议与运行时校验的唯一源码。会话目录已在服务端解析请求和响应，并在客户端以 `unknown` 接收后解析响应；其他动作仍需迁移，不代表全量 schema 已完成。目录摘要仅包含公开对端资料、最后消息的 ID/正文/ISO 时间、未读数与匿名目标，不返回发送者、收件人或数据库内部字段。

`npm run build:contracts` 会编译契约并将 TypeScript 源文件生成到 `apps/miniprogram/generated/contracts`，微信工具可直接编译这些文件；禁止手工修改生成目录。首次打开微信项目之前运行 `npm run check`，修改契约后重新运行构建或检查。

`npm run build:cloud` 使用 esbuild 从当前源码解析真实依赖，将 contracts、server、adapters 和公共辅助代码直接打进各函数的 `index.js`。不依赖既有包 dist、不做导入字符串替换，也不复制整个 server 目录。CloudBase CLI 和微信项目均指向 `dist/cloudfunctions`；上传前必须先构建。隔离产物测试在仓库外临时目录加载全部六个函数（仅模拟云 SDK），可发现对本地 workspace 的意外依赖，但不替代云端执行验收。

会话目录用例位于 `packages/server/src/messaging/application/list-directory.ts`，通过 `ConversationDirectoryStore` 隔离查询实现。CloudBase 入口仅提供按当前调用者过滤的目录查询、公开资料投影和错误转换。数据库记录的所有权、匿名参与者、时间与摘要字段在用例内验证；损坏记录明确失败，不能悄悄降级为可暴露身份的普通会话。构建将 `@lucky/server` 及其契约依赖一并装入函数，独立产物测试实际调用目录用例。

### 聊天历史与同步边界

`messages.getConversation` 接受可选序号 `before: { version: 2, conversation_id, sequence }` 和 1–50 的 `limit`。旧时间戳 before/after 协议已删除。按 `(conversation_id, sync_sequence)` 倒序有界查询，响应消息按序号升序，并返回 `nextBefore`（无更早记录为 null）、`hasMore` 与 `sync_cursor`。首页的同步游标为该页最新序号，空会话为 0；翻旧页不改变客户端增量同步位置。

历史 DTO 仅返回消息标识、发送/接收显示标识、正文、状态、ISO 时间与序号，匿名对端替换为 anonymous_peer，不返回请求指纹或匿名上下文。服务端用例验证记录的会话归属、参与者、匿名线程和有序序号。部署前必须回填历史序号，并建立 schema 中的唯一 `(conversation_id, sync_sequence)` 索引；不能直接部署到尚未迁移的旧库。聊天页仅将实际加载的收件消息标记已读，离开页面不再把未浏览的旧消息全部标记已读。

### 增量同步与轮询重试

`syncConversation` 由严格 TypeScript 用例执行，接受 v2 会话序号游标和 1–50 的 limit，拒绝旧 since 字段。历史与增量共享公开消息投影，不返回数据库请求指纹或匿名上下文。同步响应的 nextCursor 必须等于最后一条消息序号；空页必须保留原游标且 hasMore 为 false。客户端在消费前验证这些条件。

消息和评论轮询每轮最多读取五页；只有整批成功交给页面后才保存游标。后续页失败时保留原游标，下一轮重试同一批，由消息/评论标识去重。关闭后的响应与错误不再更新页面。新增消息由本协议同步；已读状态通过下面的有界回执查询同步。

### 已读事务

`messages.markRead` 必须提供非空 `msgIds`，单次上限为 20，重复 ID 会去重；不再支持省略 ID 标记全部消息。用例先读取并验证全部消息属于当前会话且收件人为调用者，再读取调用者目录；状态和未读数在同一事务提交，失败整体回滚，重复提交返回 updated: 0。负数或不足以扣减的目录计数会失败，必须通过迁移/修复恢复一致性，不能忽略错误继续扣减。

已读不更新目录活动时间；如果本批包含目录最后消息，仅更新其嵌套状态。客户端将大量已加载消息去重后按 20 条顺序提交；中途失败可幂等重试原批次，账号变更会停止后续提交。当前本地测试模拟事务回滚与串行化重试，真实云事务限制和并发冲突仍需平台验证。发送者回执由有界查询同步；收件侧失败重试由下面的账号隔离队列执行。

### 发送者已读回执

`messages.getReadReceipts` 为 verified 动作，接受与聊天相同的对端/匿名目标以及 1–20 个明确的 msgIds。服务端按可信 OPENID、会话 ID、read 状态和指定 ID 查询；返回仅包含 readIds，用例再次校验记录归属和发送者，客户端拒绝超出请求范围的 ID。部署前建立 `(conversation_id, from, status, _id)` 索引。

聊天轮询每轮最多查询 20 条已加载且未确认已读的发送消息，循环覆盖其余候选。回执失败不回退已经成功交付的新消息游标；下一轮自动重试。退出或切换账号后忽略迟到回执。消息合并保留单调状态（sent → delivered → read），迟到发送/历史快照不能覆盖已读。

### 已读确认的持久重试

`services/read-queue.ts` 在调用服务端前保存待确认意图，仅记录账号分区下的对端/匿名目标、消息 ID 与重试时间，不存储正文。最多保留 500 个批次，每批 20 个 ID；超限或损坏存储明确报错，不静默丢弃旧记录。重复 ID 按会话去重。

现有 30 秒前台角标轮询负责重试，每轮最多五个事务，失败采用 2 秒起步、最高 60 秒退避。重启后恢复当前账号的记录；后台停止后续批次，账号变更后不继续提交。服务端确认成功后删除对应记录，删除存储失败允许下次幂等重试。本地存储不可写时保留进程内队列并向页面报告失败，但不能保证此时进程退出后的恢复；真实微信存储与网络切换仍需设备验证。

### 发送事务与不确定结果

发送用例位于 `packages/server/src/messaging/application/send-message.ts`。服务端先校验内容和请求 ID，重复请求必须匹配保存的 request_fingerprint，不再根据旧记录临时推算指纹。新请求检查收件用户存在并限流，然后在同一事务内写入消息、会话计数器和双方目录；所有读取先于写入。计数器与目录缺失不一致、序号非法或目录计数损坏时中止，不能作为新会话重新从 1 开始。

当前锁定 `wx-server-sdk@4.0.2` 的实际发布包 `DocumentReference.get` 实现已核对：`cloud.database({ throwOnNotFound: false })` 在文档不存在时返回 data: null，真实查询错误继续抛出。因此消息入口使用此配置并删除发送路径的宽泛 catch-and-create。官方[事务说明](https://docs.cloudbase.net/database/transaction)限定事务内按文档操作；适配器使用 doc 获取/写入，未引入事务内 where 查询。

如果提交后的确认读取失败，客户端保留请求 ID，重试取得 duplicate；不把任意异常转为“已发送成功”。发送响应使用与历史/同步相同的公开 DTO，不返回指纹或私有匿名上下文。真实 SDK 的云端事务、重试和 serverDate 解析仍须平台演练；本地回滚模拟不能替代它。

### 匿名会话目标与来源生命周期

会话目标由共享契约和 `resolve-target` 用例解析，拒绝旧 anonymousTarget 别名、空/无效匿名对象、同时提交实名与匿名目标，以及同时提交 peer/to。新匿名会话必须指向公开且匿名的帖子/评论；评论所属帖子也必须公开。服务端根据来源作者和调用者确定线程，拒绝调用者指定不匹配的线程。

已有线程通过调用者自身的 conversation_entries 文档授权，核对目录所有者、双方参与者、来源和确定性线程 ID。它不再扫描消息推算参与者，也不依赖来源内容仍公开或匿名；来源删除/改名不会泄露对端或拆散已建立会话。首次历史响应返回不含真实对端的 chat_target，客户端保存线程标识用于后续操作。来源查询失败返回 QUERY_ERROR，真实缺失返回 NOT_FOUND，不混为一种结果。

Post updates require `expected_revision` and a boolean `anonymous`. The strict application checks ownership and revision inside the transaction, reads both affected categories before any write, and commits the post and category deltas together. A stored fingerprint binds the previous revision and normalized payload: retrying the latest successful update returns its receipt without changing counters or applying new-update rate limits; a different payload or a superseded revision conflicts. Responses use the minimal mutation receipt. Public post reads map approved fields explicitly and omit request IDs and fingerprints. Real SDK transaction validation and historical revision/count reconciliation remain deployment prerequisites.

Post deletion and moderation recheck resource permissions and state inside document-only transactions. They read the affected category before writing, update status/counter atomically, and increment the post revision only on a real transition. Repeated deletion still checks ownership; repeated identical moderation is a no-op. Moderation requires the trusted administrator principal, rejects non-boolean flags, cannot restore deleted posts, and cannot publish into an inactive category. Existing rows need valid positive revisions and category counts before migration.

Post detail/list/search responses use the shared strict `PostView`: ISO timestamps, explicit public fields, positive revision and nonnegative integer counters. The server validates records before projecting; clients validate the projected response again. Anonymous responses omit real author IDs and internal metadata; category snapshots must match `category_id`. Public list/search pages reject non-published entries and duplicate IDs. Existing rows with missing/malformed required fields need migration before deploying this contract; offset pagination and the remaining read application migration are still outstanding.

Post detail reads use a strict application request with boolean `for_edit`, `skip_view_inc`, and `public_only` flags. Editing requires ownership and never increments views; unpublished flagged content is visible only to its owner or a verified server-side administrator lookup. Deleted/hidden content stays inaccessible. Identity lookup faults propagate as query failures. Required DTO fields and safe view-count limits are checked before incrementing. Detail responses use the stored category snapshot, so migration must populate that snapshot where needed. List/search pagination and read-scope migration remain separate unfinished work.

`posts.listMine` is a verified private read bound to the trusted caller, returning their published and flagged posts. It ignores caller-supplied owner IDs and rejects `public_only`. Public `posts.list` author filters always exclude anonymous posts, including when the viewer is the author. The private query adds the `(_openid, status, created_at)` index to the manifest; apply it before deployment. The client My Posts page clears on account changes and rejects stale results. List/search now both use runtime page validation; offset pagination and My Posts loading beyond its first 50 items remain unfinished.
