# WeChat Mini-Program BBS — Component & Page Architecture Research

## Problem Domain

Design the frontend component/page architecture for Lucky, a UNNC student BBS +
private messaging WeChat mini-program. Must: (1) define reusable component
hierarchy, (2) map page routing, (3) respect WeChat 2MB main-package limit
via subpackages.

---

## References

### Reference 1: WeUI / weui-miniprogram (Tencent Official)
- Source: https://github.com/wechat-miniprogram/weui-miniprogram
- **Architecture pattern**: Component library with `properties` / `events` / `slots` interface. Each component is a self-contained 4-file unit (.wxml/.wxss/.js/.json). Uses `externalClasses` for custom theming.
- **Interface design style**: Standard WeChat `Component()` constructor. `triggerEvent` for upward communication, `properties` for downward data flow.
- **Extension strategy**: `extClass` property on every component for CSS override. `watchThemeChange` for dark mode support. Root portal pattern for modal z-index stacking.
- **Error handling**: Graceful degradation — fallback to defaults when properties missing. Empty states built-in.
- **Key trade-offs**:
  - **Decision**: WeUI over Vant Weapp | **Alternative**: Vant Weapp (larger, more components) | **Reason**: WeUI is lighter, official, matches WeChat visual language. Vant adds ~500KB to bundle.
  - **Decision**: CSS variables for theming | **Alternative**: JS-driven style injection | **Reason**: CSS variables are zero-runtime, work with WeChat style isolation.

### Reference 2: CNode / 博客园 WeChat Mini-Program BBS (Community Practice)
- Source: https://juejin.cn/post/7577681092137992227
- **Architecture pattern**: Multi-page with shared `components/` directory. Pages organized by domain (index, topic, user, publish, search, message). Each page loads only needed components via page-level `.json` registration.
- **Interface design style**: MVVM with `this.setData()` for reactive updates. Data fetching in `onLoad`/`onShow` lifecycle. Pull-to-refresh + infinite scroll for list pages. `wx.navigateTo` for page transitions.
- **Extension strategy**: Business components under `components/business/`, base UI under `components/base/`. New pages added to `app.json` pages array. Subpackages for heavy modules (chat, rich editor).
- **Error handling**: `wx.request` fail callback → toast or inline error state. `wx.showToast` for transient errors, inline retry button for persistent failures.
- **Key trade-offs**:
  - **Decision**: Flat page structure (not nested) | **Alternative**: Tabs-within-pages | **Reason**: Simpler routing, each page is independently navigable. Tab switching at top-level only.

### Reference 3: WeChat Mini-Program Reusable List/Search Components (Engineering Practice)
- Source: https://wenku.csdn.net/doc/74trj5pdmx
- **Architecture pattern**: Container-component separation. List container handles scroll, pagination, refresh — slot for item rendering. Search bar handles input, debounce, history — events for search action.
- **Interface design style**:
  - List component: `properties` = {tabList, defaultTab}, `events` = {onLoadMore, onRefresh, onTabChange}. Internal `isLoadMore` flag prevents duplicate triggers.
  - Search component: `properties` = {placeholder, hotKeys, historyKeys}, `events` = {onsearch, oninput}. Debounce 300ms on input. LRU eviction for history (last 10-20).
- **Extension strategy**: Named slots (`<slot name="item">`) for flexible list item rendering. `externalClasses` for search bar styling.
- **Error handling**: Two-tier cache (memory + `wx.Storage`) for search history. Graceful degrade when storage full. Empty state when no results.
- **Key trade-offs**:
  - **Decision**: Debounce on client | **Alternative**: Server-side throttling | **Reason**: Client debounce reduces wasted API calls without server infra.
  - **Decision**: `scroll-view` with bindscrolltolower | **Alternative**: Virtual list (recycle-view) | **Reason**: Simpler implementation. Virtual list only needed for >500 item lists.

---

## Comparison

| Dimension | WeUI Official | CNode/Blog BBS Pattern | List/Search Pattern |
|-----------|--------------|----------------------|---------------------|
| Component model | properties/events/slots | Same, plus business/ base split | Container-slot separation |
| List strategy | Built-in scroll-view | Pull-refresh + infinite scroll | Container handles scroll logic |
| Search strategy | weui-searchbar | Van-search (Vant) | Debounce + LRU history |
| State management | Component-local | Page-level setData | Memory + Storage cache |
| Bundle impact | ~200KB | Project-dependent | N/A (pattern, not library) |
| Code reuse | npm package | Project components/ dir | Template pattern |

---

## Trade-off Analysis

**WeUI vs Vant Weapp**: WeUI chosen. WeUI is the official Tencent library, ~200KB lighter than Vant, matches WeChat native visual language. Vant adds `van-search`, `van-tabs`, `van-cell` which are individually useful but pulling them in pulls the whole theme system. Decision: use WeUI for base components, write custom business components (ReelSearch, ReelList) for domain-specific needs. Add individual Vant components only if WeUI falls short.

**Custom ReelSearch/ReelList vs library**: Custom chosen. The user's `ReelSearch` + `ReelList` pattern is domain-specific — category-filtered post search with infinite scroll. No off-the-shelf component covers this exact combination. Building as custom components with the standard properties/events/slots interface keeps the bundle lean and the API exactly matching the data model.

---

## Recommendations

### Component Inventory (matches user structure)

```
components/
├── reel-search/       # 搜索栏 + 分类筛选 + 热门关键词
│   ├── reel-search.json
│   ├── reel-search.wxml
│   ├── reel-search.wxss
│   └── reel-search.ts
│
├── reel-list/          # 通用列表容器: 无限滚动 + 下拉刷新 + 空/加载态
│   ├── reel-list.json
│   ├── reel-list.wxml
│   ├── reel-list.wxss
│   └── reel-list.ts
│
├── post-card/          # 帖子卡片 (reel-list 的 slot 子项)
├── comment-item/       # 评论项 (支持嵌套)
├── message-bubble/     # 聊天气泡
├── user-avatar/        # 头像 (默认兜底)
├── category-tag/       # 话题圈标签
├── loading-shell/      # 骨架屏
└── empty-state/        # 空状态
```

**ReelSearch interface**:
```
properties: {placeholder, categories, hotKeys}
events: {onsearch(keyword, category), oninput(value)}
internal: debounce(300ms), search history in wx.Storage (LRU, max 20)
```

**ReelList interface**:
```
properties: {emptyText, loadingText, hasMore}
events: {onloadmore, onrefresh, onitemtap(item)}
slots: <slot name="item"> for post-card rendering
internal: scroll-view + bindscrolltolower, isLoadMore guard flag
```

### Page Map (matches user structure)

```
pages/
├── login/              # [登陆] — 微信一键登录, wx.login → JWT
├── index/              # [首页] — ReelSearch + ReelList(post-card), 分类 tab
├── search/             # [首页:搜索页面] — 全屏 ReelSearch + 搜索结果 ReelList
├── topics/             # [首页:话题圈] — 话题圈列表, 预设: 校园生活/其他
├── post/               # [帖子] — 标题+正文+评论区(comment-item), 2级嵌套
├── post-edit/          # [帖子:编辑] — 标题输入+正文输入+话题圈选择
├── messages/           # [私信] — 会话列表 ReelList(message-bubble preview)
├── chat/               # [私信:聊天室] — 消息流 + 发送框 + WS 状态
└── profile/            # [个人中心] — 头像/昵称/微信绑定/邮箱认证/我的帖子
```

### Subpackage Strategy

```
主包 (main, <2MB):
  login, index, search, topics, post, post-edit, profile
  + components/* (shared)
  + services/* (api, auth, storage)

独立分包 (chat, <2MB):
  messages, chat
  + services/ws (WebSocket client)
```

### Global Layout Pattern

```
[ReelSearch]          ← 搜索筛选栏 (sticky top)
[ReelList]            ← 内容列表 (scrollable, slot=item)
  ├── [post-card]     ← 列表项
  ├── [post-card]
  └── [loading-shell | empty-state]
```

`通用列表 = ReelSearch + ReelList` — 首页、搜索页、话题圈、消息列表、我的帖子 都复用这对组合。

---

## Sources

- [WeUI-miniprogram — Tencent Official](https://github.com/wechat-miniprogram/weui-miniprogram)
- [WeChat Mini-Program Component Best Practices — CSDN](https://wenku.csdn.net/doc/74trj5pdmx)
- [博客园 WeChat BBS Architecture Analysis — Juejin](https://juejin.cn/post/7577681092137992227)
- [wxSearch Component Design — GitCode](https://blog.gitcode.com/17949dc5667de39e75c06c7548674b92.html)
