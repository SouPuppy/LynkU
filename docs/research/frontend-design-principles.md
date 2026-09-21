# WeChat Mini-Program Frontend Design Principles — Lucky BBS

> Scope: Production-grade frontend design guidelines for a CloudBase-powered
> WeChat mini-program BBS. Not actual design — principles to follow when
> designing.
> Date: 2026-07-21
> Related: [[frontend-tech-stack]], [[wechat-cloud-development]], [[lucky-bbs]]

## Problem Domain

Lucky BBS is a WeChat mini-program campus forum with real-time messaging,
targeting ~10k UNNC students. The frontend uses WeChat Native (TypeScript +
Skyline + Glass-Easel), backed by CloudBase (cloud functions + document DB +
watch). After the backend migration to CloudBase, the frontend architecture
needs a set of design principles that produce professional, maintainable,
production-grade code — not a quick prototype that becomes unmaintainable after
3 features.

This document defines the "what to think about" before writing code. It is NOT
a design spec — it's the design philosophy and patterns that inform the spec.

---

## Principle 1: Layered Data Access

### The problem

CloudBase gives the mini-program **direct database access** (`wx.cloud.database()`).
This is powerful but dangerous — sprinkling `db.collection('posts').where(...)`
across 15 pages means 15 places to fix when the data shape changes.

### The rule

All data access goes through a service layer. Pages and components never call
`wx.cloud.database()` or `wx.cloud.callFunction()` directly.

```
Page/Component (UI layer)
       │
       ▼
services/ (data access layer)
       │
       ├── db.ts       → wx.cloud.database() calls (reads)
       ├── cloud.ts    → wx.cloud.callFunction() calls (writes)
       └── auth.ts     → login, user profile, identity
       │
       ▼
CloudBase (cloud functions + database)
```

### Concrete pattern

```typescript
// services/posts.ts — THE single module for post data access
import { db } from './db'

export const posts = {
  async list(params: ListPostsParams): Promise<Post[]> {
    const res = await db.collection('posts')
      .where({ category_id: params.categoryId, status: 'published' })
      .orderBy('created_at', 'desc')
      .skip(params.offset)
      .limit(params.limit)
      .get()
    return res.data as Post[]
  },

  async create(data: CreatePostData): Promise<Post> {
    const res = await wx.cloud.callFunction({
      name: 'posts',
      data: { action: 'create', ...data }
    })
    return res.result.post
  },
}

// pages/forum/forum.ts — page only calls services
import { posts } from '../../services/posts'

Page({
  async onLoad() {
    this.setData({ posts: await posts.list({ categoryId: 'academic' }) })
  }
})
```

### Why

- One place to change DB field names, query logic, or error handling
- Pages stay thin (coordination) — services hold logic
- Testable: mock `services/posts` without touching CloudBase
- Works with mock data during UI development (swap service implementation)

### Anti-pattern

```typescript
// DON'T: direct DB call in page
Page({
  async onLoad() {
    const db = wx.cloud.database()
    const res = await db.collection('posts')
      .where({ category_id: this.data.catId })
      .get()
    this.setData({ posts: res.data })
  }
})
```

---

## Principle 2: Component Responsibility Split

### The rule

Every component is exactly one of:

| Type | Responsibility | Has data fetching? | Has business logic? | Example |
|------|---------------|-------------------|--------------------|---------|
| **Presentation** | Render data, emit events | No | No | `post-card`, `avatar`, `comment-item` |
| **Container** | Fetch data, manage page state | Yes | Yes | `forum-feed`, `chat-window` |
| **Utility** | Shared behavior, no UI | No | Limited | `loading-mixin`, `pagination-behavior` |

### Why this split matters

Mixing data fetching into a presentation component makes it unreusable. A
`post-card` that fetches its own author data can't be used in a search result
where author data is already available. A `post-card` that only renders
`properties.post` can be used anywhere.

### Concrete pattern

```typescript
// Presentation component: accepts data, renders it, emits events
// components/post-card/post-card.ts
Component()
  .property('post', Object)       // data comes IN via property
  .property('showCategory', Boolean)
  .methods({
    onTap() {
      this.triggerEvent('select', { postId: this.data.post._id })  // events go OUT
    }
  })
  .register()

// Container: fetches data, passes to presentation components
// pages/forum/forum.ts
Page({
  async onLoad() {
    const posts = await posts.list({ categoryId: this.data.categoryId })
    this.setData({ posts })
  }
})
```

```xml
<!-- forum.wxml — container passes data down -->
<post-card wx:for="{{posts}}" wx:key="_id"
  post="{{item}}"
  bind:select="onPostSelect"
/>
```

### Anti-pattern

```typescript
// DON'T: presentation component that fetches data
Component()
  .lifetime('attached', async function() {
    const db = wx.cloud.database()
    const res = await db.collection('posts')...  // component shouldn't know about DB
    this.setData({ post: res.data })
  })
```

---

## Principle 3: watch() Lifecycle Management

### The problem

`db.collection().watch()` creates a persistent connection. Every `watch()` that
isn't `close()`d is a memory leak and a connection that counts against CloudBase
quotas.

### The rule

Every `watch()` is paired with a `close()` in the same scope. Prefer page-level
watch over component-level watch.

```typescript
// pages/chat/chat.ts
Page({
  onLoad() {
    this._watcher = db.collection('messages')
      .where(/* conversation filter */)
      .watch({
        onChange: (snapshot) => {
          this.setData({ messages: snapshot.docs })
        },
        onError: (err) => {
          console.error('watch error', err)
        }
      })
  },

  onUnload() {
    this._watcher?.close()  // ALWAYS close
  }
})
```

### Rules of thumb

- One watch per active page max. If you need multiple collections, merge into
  one cloud function write target.
- Watch subscription filter should be as narrow as possible (conversation ID,
  not all messages).
- `onError` handler is mandatory — silent watch failures are hard to debug.
- Don't watch in components. Components get created/destroyed frequently; pages
  live longer.

---

## Principle 4: Denormalized Reads, Normalized Writes

### The problem

CloudBase document DB has no JOINs. A post listing needs author nickname +
avatar, which lives in the `users` collection. Two options: (A) fetch posts,
then fetch each author separately (N+1), or (B) store author info in the post
document.

### The rule

**Write-time denormalization, read-time direct access.** When a post is created,
copy the author's `nickname` + `avatar_url` into the post document. Reads are
one query. When the user updates their profile, a cloud function syncs the
change to all their posts (eventually consistent).

```javascript
// Cloud function: create post
const user = await db.collection('users').doc(openid).get()
await db.collection('posts').add({
  data: {
    title: event.title,
    content: event.content,
    author: {                    // denormalized at write time
      _openid: openid,
      nickname: user.data.nickname,
      avatar_url: user.data.avatar_url,
    },
    created_at: db.serverDate(),
  }
})
```

### When NOT to denormalize

- Data that changes every few seconds (presence, live counters)
- Data where accuracy matters more than latency (payment amounts)
- Data referenced by <3 readers (not worth the sync complexity)

---

## Principle 5: setData Discipline

### The problem

`setData` is the bridge between logic layer and render layer. Every call has
cost: serialization, cross-thread transfer (WebView mode), or tree diff
(Skyline mode). Skyline eliminates serialization cost but over-calling still
causes unnecessary re-renders.

### The rules

1. **Batch updates**: one `setData` with all changes, not three separate calls
2. **Minimal payload**: only the fields that changed, not the whole object
3. **Path updates for nested data**: `setData({'posts[3].comment_count': 5})`
   not `setData({posts: entirePostsArray})`
4. **No setData in loops**: accumulate changes, call once at end

```typescript
// GOOD: batched, path-based
const updates = {}
this.data.newMessages.forEach((msg, i) => {
  updates[`messages[${i}]`] = msg
})
this.setData(updates)

// BAD: looped setData
messages.forEach(msg => {
  this.setData({ messages: [...this.data.messages, msg] })  // N setData calls
})
```

### Skyline-specific note

Skyline's single-thread model means `setData` is synchronous (no IPC). Still,
less data = less tree diff = faster. The batch rule still applies.

---

## Principle 6: Error State Coverage

### The problem

Most mini-program code handles the happy path: load data, render list. Production
code handles four states per view: loading, empty, error, retry.

### The rule

Every data-fetching page/view implements all four states. Use a consistent
pattern:

```typescript
// services/state.ts — reusable state machine
export type LoadState = 'idle' | 'loading' | 'loaded' | 'empty' | 'error'

// pages/forum/forum.ts
Page({
  data: {
    state: 'idle' as LoadState,
    posts: [] as Post[],
    errorMessage: '',
  },

  async loadPosts() {
    this.setData({ state: 'loading' })
    try {
      const result = await posts.list({ categoryId: this.data.categoryId })
      this.setData({
        posts: result,
        state: result.length === 0 ? 'empty' : 'loaded',
      })
    } catch (e) {
      this.setData({
        state: 'error',
        errorMessage: e.message || '加载失败',
      })
    }
  },
})
```

```xml
<!-- forum.wxml -->
<loading-skeleton wx:if="{{state === 'loading'}}" />
<empty-view wx:elif="{{state === 'empty'}}" message="暂无帖子" />
<error-view wx:elif="{{state === 'error'}}" message="{{errorMessage}}" bind:retry="loadPosts" />
<post-list wx:else posts="{{posts}}" />
```

### Mandatory error handling

- Cloud function call failures (network, timeout, business error)
- `watch()` errors (subscription limits, network loss)
- `wx.login()` failure (WeChat service unavailable)
- CloudBase init failure (wrong environment ID)

### The `<empty>` component

One shared `components/empty/empty` component used everywhere. Props: `icon?`,
`message`, `actionLabel?`. Emits `action` event for "create first post" / "start
a conversation" CTAs. Don't inline empty states per page.

---

## Principle 7: Skyline/Glass-Easel Native Constraints

### The hard constraints (from official docs + production experience)

| Constraint | Impact | Workaround |
|-----------|--------|-----------|
| No native navigation bar | Every page needs custom nav | One `<nav-bar>` component used in every page WXML |
| No global scroll | Must use `<scroll-view>` | `"disablesScroll": true` in page config. All pages use scroll-view |
| No CSS `line-clamp` | Text truncation needs `<text max-lines>` | Use `<text max-lines="{{2}}">` for post excerpts |
| Style isolation stricter | No dynamic `addGlobalClass` | Static `styleIsolation: "apply-shared"` in component JSON |
| Default flex layout | Need explicit `flex-direction: row` | CSS — safe default but remember for horizontal layouts |
| `z-index: 0` on PC | PC mini-program renders differently | Avoid `z-index` tricks; use DOM order for stacking |

### App.json baseline

```json
{
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "lazyCodeLoading": "requiredComponents",
  "rendererOptions": {
    "skyline": {
      "defaultDisplayBlock": true
    }
  },
  "window": {
    "navigationStyle": "custom"
  }
}
```

### WXSS baseline

```css
/* app.wxss — global reset for Skyline */
page {
  height: 100%;
  overflow: hidden;  /* no global scroll */
}
```

---

## Principle 8: Subpackage Stratification

### The problem

Main package limit is 2MB. All code in one package hits this fast with a BBS +
chat app.

### The rule

Split by user journey. Chat module is an independent subpackage because:
- Not needed on first load (user browses forum first)
- Only loaded when user taps "Messages" tab or a "DM" button
- Independent means it can share nothing with main package, reducing main
  package size

```
main package (<2MB):
  ├── pages/index/        (forum feed — first screen)
  ├── pages/post/         (post detail)
  ├── pages/create/       (create post)
  ├── pages/profile/      (user profile)
  ├── components/         (shared: post-card, avatar, comment-item, empty, nav-bar)
  ├── services/           (db.ts, auth.ts, posts.ts, categories.ts)
  └── utils/

subpackages:
  ├── chat/               (independent subpackage)
  │   ├── pages/conversations/
  │   ├── pages/chat/
  │   ├── services/       (messages.ts — only loaded with chat)
  │   └── components/     (chat-bubble, message-input)
  └── admin/              (optional future subpackage)
      └── pages/moderation/
```

### Preload strategy

```json
// app.json
{
  "preloadRule": {
    "pages/index": {
      "network": "all",
      "packages": ["chat"]     // preload chat when forum loads, on WiFi
    }
  }
}
```

---

## Principle 9: TypeScript, Not AnyScript

### The rule

Every CloudBase document has a TypeScript type. No `any` in service layer
return types.

```typescript
// types/post.ts
export interface Post {
  _id: string
  _openid: string
  title: string
  content: string
  category_id: string
  status: 'published' | 'flagged' | 'hidden'
  view_count: number
  comment_count: number
  author: {
    _openid: string
    nickname: string
    avatar_url: string
  }
  created_at: Date
  updated_at: Date
}

// services/posts.ts
export async function listPosts(params: ListPostsParams): Promise<Post[]> {
  const res = await db.collection('posts')
    .where({ ... })
    .get()
  return res.data as Post[]  // typed cast, not any
}
```

### What gets types

- Every CloudBase collection document shape
- Every cloud function call result (`wx.cloud.callFunction()` return)
- Every component `property` definition (Glass-Easel Chaining API supports
  TypeScript generics)
- Every page `data` shape

---

## Principle 10: CSS Variable Theming

### The rule

One set of design tokens as CSS variables. Zero hardcoded colors in components.

```css
/* app.wxss */
page {
  --color-primary: #07C160;       /* WeChat green */
  --color-primary-active: #06AD56;
  --color-bg: #F6F6F6;
  --color-bg-card: #FFFFFF;
  --color-text-primary: #191919;
  --color-text-secondary: #888888;
  --color-text-muted: #B0B0B0;
  --color-divider: #E5E5E5;
  --color-error: #FA5151;
  --color-warning: #FFC300;

  --font-size-xs: 24rpx;
  --font-size-sm: 28rpx;
  --font-size-md: 32rpx;
  --font-size-lg: 36rpx;

  --spacing-xs: 8rpx;
  --spacing-sm: 16rpx;
  --spacing-md: 24rpx;
  --spacing-lg: 32rpx;

  --radius-sm: 8rpx;
  --radius-md: 12rpx;
  --radius-round: 9999rpx;
}
```

```css
/* components/post-card/post-card.wxss — never hardcoded */
.post-card {
  background: var(--color-bg-card);
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
}
.post-card__title {
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
}
```

### Why this is production-grade

- Dark mode: swap CSS variable values, all components follow
- Design iteration: change `--color-primary`, entire app updates
- Consistency: no designer-vs-developer drift on colors/spacing

---

## Principle 11: Service Layer as the Data Boundary

### The complete services/ directory

```
services/
├── db.ts              # wx.cloud.database() initialization, collection references
├── cloud.ts           # wx.cloud.callFunction() typed wrapper
├── auth.ts            # login flow, user profile, identity cache
├── posts.ts           # post CRUD, search, listing
├── comments.ts        # comment CRUD, tree building
├── messages.ts        # message send, conversation list, unread count
├── categories.ts      # category list
├── users.ts           # user profile read/update
├── storage.ts         # wx.Storage typed wrapper (drafts, preferences)
└── state.ts           # LoadState type, state machine helper
```

### db.ts — single init point

```typescript
// services/db.ts
const db = wx.cloud.database()
const _ = db.command

export { db, _ }

// Named collection accessors (avoids magic strings across codebase)
export const collections = {
  posts: db.collection('posts'),
  comments: db.collection('comments'),
  messages: db.collection('messages'),
  categories: db.collection('categories'),
  users: db.collection('users'),
}
```

### cloud.ts — typed callFunction

```typescript
// services/cloud.ts
export async function callCloud<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const res = await wx.cloud.callFunction({ name, data })
  if (res.result?.error) {
    throw new CloudError(res.result.error, res.result.code)
  }
  return res.result as T
}
```

---

## Principle 12: Authentication — Simpler Than Before

### Old pattern (deleted)

`wx.login()` → get code → `POST /api/auth/login` → store JWT → inject on every
request → handle 401 refresh.

### CloudBase pattern (replacement)

`wx.cloud.init()` once in `app.ts`. That's it. Every cloud function call is
automatically authenticated. `cloud.getWXContext().OPENID` in cloud function
gives the caller identity.

```typescript
// services/auth.ts — dramatically simplified
import { collections } from './db'
import { callCloud } from './cloud'

export const auth = {
  async ensureUser(): Promise<User> {
    // CloudBase runtime identifies the user. We just ensure
    // a user document exists in the users collection.
    const res = await callCloud<{ user: User }>('login', { action: 'ensure' })
    return res.user
  },

  async getProfile(): Promise<User | null> {
    try {
      const storage = wx.getStorageSync('user_profile')
      return storage || null
    } catch {
      return null
    }
  },

  setProfile(user: User): void {
    wx.setStorageSync('user_profile', user)
  },

  clearProfile(): void {
    wx.removeStorageSync('user_profile')
  },
}
```

### What goes away

No JWT token storage. No token refresh timers. No 401 interception. No token
injection in request headers. The platform handles identity.

---

## Principle 13: Offline Awareness

### The problem

Mini-programs can go offline (tunnel, elevator, subway). CloudBase calls will
fail. Production apps handle this gracefully.

### The rule

Minimal: detect network, show banner. Don't queue writes offline (complex, low
ROI for BBS).

```typescript
// app.ts
App({
  onLaunch() {
    wx.onNetworkStatusChange((res) => {
      this.globalData.online = res.isConnected
      if (!res.isConnected) {
        wx.showToast({ title: '网络已断开', icon: 'none' })
      }
    })
  }
})
```

For chat: if `watch()` disconnects, the SDK auto-reconnects. When it reconnects,
it pushes all changes that happened during disconnect (the database is the
queue). No extra offline logic needed.

---

## Principle 14: Keep It Simple (Ponytail Applied)

Rules that are explicitly NOT needed until there's evidence:

| Skip | Why | Add when |
|------|-----|---------|
| State management library (MobX, etc.) | `setData` + service layer is enough for page-local state. Auth is the only global state. | Page count > 20 AND cross-page state bugs appear |
| Component library (Vant, TDesign) | ~500KB for components we may not use. WeUI covers basics. Skyline compatibility issues with Vant. | Need 5+ complex form components (picker, datetime, uploader) |
| Offline write queue | BBS is read-heavy. Writes are infrequent. Lost "create post" during offline = acceptable. | Users report data loss regularly |
| Image upload pipeline | MVP has no image upload. Text-only. | File upload enters scope |
| WXS for data formatting | Skyline handles formatting in JS efficiently. Premature optimization. | Profile shows measurable render jank in timestamp formatting |
| Custom navigation bar per page | One shared `<nav-bar>` component. | Per-page custom nav actions (search bar, filter chips) |

---

## Summary: The 14 Principles

| # | Principle | One-line |
|---|-----------|----------|
| 1 | Layered data access | Pages call services; services call CloudBase |
| 2 | Component responsibility split | Presentation (render) vs Container (fetch) |
| 3 | watch() lifecycle | Every `watch()` has a paired `close()` |
| 4 | Denormalized reads | Store author info in post doc, avoid N+1 |
| 5 | setData discipline | Batch, minimal, path-based, no loops |
| 6 | Error state coverage | Every view: loading / empty / error / retry |
| 7 | Skyline constraints | Custom nav, scroll-view, no line-clamp |
| 8 | Subpackage stratification | Chat = independent subpackage |
| 9 | TypeScript everywhere | Every document, call, component has types |
| 10 | CSS variable theming | Design tokens, zero hardcoded colors |
| 11 | Service layer boundary | Single `services/` module per domain |
| 12 | Auth simplified | No JWT. Platform handles identity. |
| 13 | Offline awareness | Detect, notify, don't over-engineer |
| 14 | Ponytail restraint | Skip state libs, component libs, WXS, offline queue |

---

## When to deviate

These principles are optimized for Lucky BBS at UNNC scale (~10k users, low
concurrency, read-heavy). If any of these change, revisit:

- **DAU > 5,000**: Add performance monitoring, watch connection quotas
- **Chat becomes group chat**: Message data model changes, watch filter widens
- **Image/video uploads added**: New component types, cloud storage integration
- **Multiple mini-programs share backend**: Extract shared cloud functions, use
  environment sharing
- **Real-time features multiply**: Evaluate dedicated watch collection pattern
  (write to cache collection, watch cache)

---

## References

1. **WeChat Skyline Features (Official)**: https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/features.html
2. **Glass-Easel Chaining API (Official)**: https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/glass-easel/chaining-api.html
3. **CloudBase Database in Mini Program (Official)**: https://docs.cloudbase.net/recipes/add-database-wechat-miniprogram
4. **CloudBase Real-time Watch (Official)**: https://docs.cloudbase.net/recipes/add-realtime-notifications-database-watch
5. **WeChat Mini-Program Architecture Analysis (DeepWiki)**: https://deepwiki.com/do-once/starter-mp/2-architecture
6. **Glass-Easel GitHub (Official)**: https://github.com/wechat-miniprogram/glass-easel
7. **starter-mp Production Template**: https://github.com/do-once/starter-mp
8. **Skyline + Glass-Easel Migration Guide (Bookstack)**: https://www.bookstack.cn/read/miniprogram-202505
