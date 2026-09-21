# Kotlin Backend Architecture for Lucky BBS -- Research Report

## Problem Domain

Build a backend for a UNNC student forum (BBS) + private messaging platform. The
frontend is a WeChat miniprogram. Backend must handle: WeChat OAuth login, JWT
session management, CRUD for posts/comments/categories, cursor-paginated feeds,
full-text search, private messaging (future: WebSocket), and user profiles.

Scale: campus-level (~10K-20K users), low concurrency. B2 student project --
prioritize simplicity and fast iteration over enterprise patterns.

## Frontend-Derived API Contract

Analysis of `frontend/miniprogram/` yields these endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | WeChat code -> JWT + User |
| GET | `/api/categories` | List all categories |
| GET | `/api/posts` | Feed with cursor pagination (`?limit=&cursor=&category=&search=`) |
| POST | `/api/posts` | Create post `{title, content, categoryId}` |
| GET | `/api/posts/:id` | Single post detail |
| GET | `/api/posts/:id/comments` | Nested comments for a post |
| GET | `/api/messages` | Conversations list + messages by conversation |
| GET | `/api/user` | Current user profile |

Auth: Bearer JWT in `Authorization` header. HTTP 401 triggers client-side
redirect to login. No WebSocket yet (chat is local-only prototype), but
`EPIC-001` scope includes real-time messaging.

### Data Models

```
User:       id, openid, nickname, avatarUrl, role(user|admin),
            email?, bio?, wechatBound, emailVerified, postCount, createdAt

Category:   id, name, slug, description, sortOrder, postCount, color

Post:       id, title, content, author{id,nickname,avatarUrl}, categoryId,
            categoryName, viewCount, commentCount, status, createdAt, updatedAt

Comment:    id, content, author{id,nickname,avatarUrl}, createdAt,
            replies[{id, content, author, replyTo{nickname}, createdAt}]

Message:    id, fromId, toId, content, status(sent|delivered|read), createdAt

Conversation: id, otherUser{id,nickname,avatarUrl}, lastMessage, lastTime,
              unreadCount
```

## References

### Reference 1: Ktor 3 + Koin + Exposed (Official + Community)

- Source: https://ktor.io/docs/server-application-structure.html
- Source: https://github.com/emanueltns/kmp-ktor-template
- Architecture pattern: Layered (config -> plugins -> controller -> service ->
  -> repository -> domain -> dto). Feature-based modules at larger scale.
- Interface design style: Ktor Routing DSL, kotlinx.serialization for JSON.
- Extension strategy: Ktor plugins (Authentication, ContentNegotiation,
  StatusPages, CORS, WebSockets). Koin modules for DI.
- Error handling approach: StatusPages plugin catches exceptions -> typed JSON
  error responses. `Result<T>` or sealed class in service layer.
- Key trade-offs: Minimal magic vs Spring's auto-config. Bring-your-own-DI
  vs Spring's built-in IoC. Lighter runtime but smaller ecosystem.

### Reference 2: Ktor vs Spring Boot Performance (Academic + Community)

- Source: https://ph.pollub.pl/index.php/jcsi/article/view/9586 (2026 academic)
- Source: https://dev.to/software_mvp-factory/ktor-3-vs-spring-boot-3-for-mobile-backends-15dl
- Architecture pattern: N/A (comparative benchmark)
- Interface design style: N/A
- Extension strategy: N/A
- Error handling approach: N/A
- Key trade-offs:
  - Ktor: ~45MB idle, ~0.8s cold start, ~48K req/s. Coroutine-native.
  - Spring Boot: ~120MB idle, ~3.2s cold start, ~41K req/s. Virtual threads
    still preview. Larger ecosystem (Security, Data, Actuator).
  - For campus-scale (<20K users), performance gap is irrelevant. Cold start
    matters for dev iteration speed, not production load.

### Reference 3: WeChat Mini Program Login + JWT Pattern

- Source: https://wenku.csdn.net/answer/3rc7t5jsxdob (Spring Boot + WeChat)
- Source: https://github.com/echo-cool-coding/cool-coding (Node.js, pattern
  applies to any backend)
- Architecture pattern: OAuth2-like code exchange
  1. Mini program calls `wx.login()` -> code
  2. Backend receives code, calls WeChat `jscode2session` API ->
     `{openid, session_key}`
  3. Upsert user by openid, issue JWT (userId + role in claims)
  4. Client stores JWT, sends as `Authorization: Bearer <token>`
- Interface design style: Single `/api/auth/login` endpoint. Stateless JWT --
  no server-side sessions.
- Extension strategy: Refresh token rotation when token lifetime matters.
  Redis cache for session_key (avoids repeated WeChat API calls).
- Error handling approach: WeChat API failures -> 502. Invalid code -> 400.
  Expired JWT -> 401.
- Key trade-offs: Stateless JWT means no token revocation (until expiry).
  Acceptable for student project. Add refresh tokens + blacklist later.

### Reference 4: Ktor WebSocket + JWT Authentication

- Source: https://discuss.kotlinlang.org/t/websocket-ktor/30485
- Source: https://slack-chats.kotlinlang.org/t/30405410
- Architecture pattern:
  - `webSocketRaw` handler for max control
  - JWT passed as query param `?token=` (browser environments block custom
    headers on WS upgrade)
  - Validate JWT on connect, track connections in a concurrent repository,
    clean up in `finally` block
- Interface design style: Coroutine-based message handling. `incoming.consumeEach`
  for frame dispatch. Send via `outgoing.send(Frame.Text(json))`.
- Extension strategy: Application-level heartbeat on top of Ktor's ping/pong.
  Per-user connection map (one connection per user -- simpler than multi-device).
- Error handling approach: Invalid token -> close with VIOLATED_POLICY reason.
  Message parse failure -> log + skip (don't crash the connection).
- Key trade-offs: Single connection per user is simple but blocks multi-device.
  Query-param JWT is less secure than header (logged in proxies). Acceptable
  for campus app.

## Comparison

| Dimension | Ktor 3 | Spring Boot 3 |
|-----------|--------|---------------|
| **Learning curve** | Low for Kotlin devs -- idiomatic DSL | Medium -- Spring annotations + magic |
| **Cold start** | ~0.8s | ~3.2s |
| **Memory idle** | ~45MB | ~120MB |
| **Concurrency** | Coroutines (mature) | Virtual threads (preview) |
| **DI** | Koin (opt-in, no reflection) | Built-in IoC (reflection) |
| **Ecosystem** | Growing plugins | Massive (Security, Data, Cloud) |
| **Testing** | `testApplication` engine | `@SpringBootTest` |
| **Project size fit** | Medium | Large / enterprise |
| **WeChat integration** | Manual (Ktor HTTP client) | Manual (WebClient) |

## Trade-off Analysis

**Ktor over Spring Boot for this project:**

For a campus forum with ~10K users, either framework works. The decision comes
down to developer experience, not performance.

- **Simplicity wins**: Ktor's explicit DSL means less "why is this not working"
  debugging. No annotation scanning, no hidden bean wiring. A student project
  benefits from transparency.
- **Coroutines are native**: No bridging between reactive streams and coroutines.
  Every handler is `suspend` by default.
- **Lighter CI/CD**: Faster cold start = faster test cycles in GitHub Actions.
- **Cost of smaller ecosystem**: We need PostgreSQL + JWT + JSON. Ktor has
  first-party plugins for all three. We don't need Spring Security's LDAP or
  OAuth2 provider integrations.

**Risk**: Ktor's community is smaller than Spring's. Mitigation: the official
JetBrains documentation is excellent, and the patterns we need (REST + DB +
JWT) are well-covered.

## Recommendations

### Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Ktor 3.4 (Netty) | Kotlin-native, coroutine-first, fast enough |
| DI | Koin 4.0 | Zero-reflection, Ktor-native, simple DSL |
| DB | PostgreSQL 17 | Reliable, campus-scale overkill but correct choice |
| ORM | Exposed 0.56 (DSL) | Kotlin type-safe SQL, coroutine-compatible |
| Migrations | Flyway | Industry standard, versioned SQL |
| Auth | JWT (auth0 `java-jwt` or `kotlin-jwt`) | Stateless, simple |
| JSON | kotlinx.serialization | Kotlin-native, compile-time safe |
| HTTP client | Ktor Client (CIO) | For WeChat API calls, coroutine-native |
| Dev env | Docker Compose | PostgreSQL + app, one-command start |
| WebSocket | Ktor WebSockets plugin | In-framework when chat goes real-time |

### Module Structure

```
src/main/kotlin/com/lucky/
├── config/              # AppConfig, DatabaseConfig (read HOCON)
├── plugins/             # Ktor plugin installers (Serialization, Auth, StatusPages, CORS)
├── domain/              # Pure Kotlin: User, Post, Comment, Category, Message
├── dto/                 # Request/Response shapes (mirrors frontend interfaces)
├── repository/          # Exposed DSL queries (UserRepository, PostRepository, ...)
├── service/             # Business logic (AuthService, PostService, ...)
├── routes/              # Ktor route definitions (authRoutes, postRoutes, ...)
├── security/            # JWT create/verify, WeChatApiClient
└── Application.kt       # fun main() = embeddedServer(...)
```

### Phase 1 (MVP -- matches frontend mock mode)

1. Database schema (Flyway V1: users, categories, posts, comments, messages)
2. WeChat login flow (`POST /api/auth/login`)
3. JWT middleware
4. Category + Post CRUD with cursor pagination
5. Comments with single-level nesting
6. User profile endpoint

### Phase 2 (Real-time)

7. WebSocket endpoint with JWT auth
8. Connection manager (in-memory map, Redis later)
9. Message send/receive over WebSocket
10. Delivery status updates

### Sizing

- ~15 Kotlin files for MVP routes + services + repos
- ~8 Flyway migration files
- ~5 Koin modules
- ~3 config files (application.conf, compose.yml, build.gradle.kts)
