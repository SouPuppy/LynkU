# Lucky Frontend Scaffold — Design

## Problem

The existing `frontend/miniprogram/` is the stock WeChat quickstart template
(index + logs demo pages). Need a full project structure: 10 pages, 9 components,
4 service modules, mock data layer — all wired for prototype development.

## Solution

Rebuild the miniprogram directory with the page/component/service structure
defined in prior research. All data mocked. Backend replaced by `services/api.ts`
reading from `mock/*.json`.

### Directory Map

```
frontend/miniprogram/
├── app.ts                    # Global data (token, user, isMock), onLaunch
├── app.json                  # Pages, window, tabBar, subpackages, renderer
├── app.wxss                  # CSS variables, reset, global utilities
│
├── components/               # 9 reusable components
│   ├── reel-search/          # Search bar + category filter + history
│   ├── reel-list/            # Infinite scroll container + pull-refresh
│   ├── post-card/            # Post preview card
│   ├── comment-item/         # Single comment with nested reply
│   ├── message-bubble/       # Chat bubble (left/right layout)
│   ├── user-avatar/          # Avatar with default fallback
│   ├── category-tag/         # Topic circle tag (clickable)
│   ├── loading-shell/        # Skeleton screen placeholder
│   └── empty-state/          # "No data" / "No results" placeholder
│
├── pages/                    # 10 pages
│   ├── login/                # WeChat one-tap login
│   ├── index/                # Home: ReelSearch + ReelList(post-card)
│   ├── search/               # Full-screen search + results
│   ├── topics/               # Topic circles (preset: campus life, other)
│   ├── post/                 # Post detail + comments
│   ├── post-edit/            # Create/edit post
│   ├── messages/             # Conversation list
│   ├── chat/                 # 1:1 chat room
│   └── profile/              # User profile + settings
│
├── services/                 # 4 client modules
│   ├── api.ts                # wx.request wrapper, mock interceptor, JWT inject
│   ├── auth.ts               # wx.login → mock token, login state
│   └── storage.ts            # wx.Storage typed wrapper
│
├── mock/                     # Static JSON for prototype
│   ├── posts.json            # 20 sample posts across categories
│   ├── categories.json       # Topic circle definitions
│   ├── messages.json         # Sample conversations + messages
│   └── user.json             # Mock user profiles
│
└── utils/
    └── util.ts               # Date format, debounce, etc.
```

### Subpackage Split

```
main package (<2MB):
  app.*, components/*, utils/*
  pages: login, index, search, topics, post, post-edit, profile
  services: api, auth, storage

subpackage "chat" (<2MB):
  pages: messages, chat
```

### Data Flow

```
Page
  ├── onLoad → api.request('GET', '/posts', {category}) → mock/posts.json
  │          → setData({posts, loading: false})
  │
  ├── onReachBottom → api.request('GET', '/posts', {cursor}) → next page
  │                 → setData({posts: [...posts, ...newPosts]})
  │
  └── wxml → <reel-list items="{{posts}}" bindloadmore="onLoadMore">
              <post-card wx:for="{{posts}}" slot="item" />
            </reel-list>
```

### Scope

| In | Out |
|----|-----|
| 10 pages with placeholder content | Real backend integration |
| 9 reusable components (props/events/slots) | Image upload |
| Mock API layer (api.ts reads JSON) | Push notifications |
| Auth flow (wx.login → mock JWT) | Real WeChat auth |
| TabBar navigation (3 tabs) | Admin pages |
| Subpackage config | E2E tests |

### Mock Strategy

`services/api.ts` checks `getApp().globalData.isMock`. When true:
1. Match request path to a mock JSON file
2. Simulate 200-400ms network delay via `setTimeout`
3. Return parsed JSON wrapped in `{data, error: null}`

This means every page works identically in mock and real mode — only the data
source changes.

## Customer Quote

> "打开微信开发者工具，编译，10 个页面全都能点，数据虽然是假的但交互全通。
> 后端同学对着 mock JSON 直接写 API，不用猜前端要什么格式。"

## FAQ

**Q: Why 9 components? Isn't that a lot for prototype?**
Ponytail answer: the 9 components are the reusable ones. post-card appears on
4 pages (index, search, topics, my-posts). reel-list appears on 5 pages. Each
component is ~40 lines of TS + ~30 lines of WXML. Without them, those 40 lines
get copy-pasted into every page. The cost of a component is 4 files; the cost
of copy-paste is 4x the bugs.

**Q: Why mock JSON instead of a mock server?**
Zero infrastructure. Files sit in the repo, work offline, no `npm run mock-server`.
When backend is ready, delete `mock/` and flip `isMock = false`.

**Q: Subpackages for a prototype — YAGNI?**
Chat pages pull in `chat/` pages + ws service. Without subpackage, main package
creeps toward 2MB. Subpackage config is 3 lines in `app.json`. Preemptive but
costs almost nothing.

**Q: State management — really just globalData?**
Prototype, 10 pages, one user. `globalData` holds `{token, user, isMock}`.
Page state lives in `data`. wx.Storage for drafts and search history.
This covers 100% of prototype needs. Add MobX/Redux if state bugs appear.
