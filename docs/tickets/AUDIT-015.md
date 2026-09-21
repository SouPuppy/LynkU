# AUDIT-015: Index feed resets on every tab switch (onShow always reloads)

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | low |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/index/index.ts:36-43` — `onShow` always calls `this.loadPosts(true)` after first load, resetting scroll position. User browsing feed, switches tabs, returns — feed is back at top.

## Fix

Only reload on `onShow` if returning from editor (new post created). Check via a flag or event channel.


## Resolution (2026-07-23)

首页只在发帖成功或消费待处理分类筛选时刷新，普通 Tab 切换保留列表。
