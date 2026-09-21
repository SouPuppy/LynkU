# AUDIT-030: 用户资料页的加入时间与分页实现未完成

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | low |
| Parent | EPIC-006 |
| Created | 2026-07-23 |

## Problem

`PRO-001` 要求显示加入日期和最近帖子列表，但当前实现只完成了首屏：

- `cloudfunctions/users/index.js:132-134` 和 `IUserPublic` 都不返回 `created_at`。
- `pages/user/user.ts:57` 永远把 `joinDate` 设为 `''`。
- `pages/user/user.wxml:23` 仍渲染 `{{joinDate}} 加入`，出现空日期文案。
- `user.ts:65-92` 实现了非 reset 分页、`hasMore` 和 `loadingMore`，但 WXML 没有 scrolltolower/加载更多事件，20 条之后永远无法加载。

## Recommended Fix

在公开资料 DTO 中加入格式明确的 `created_at`/`joinDate`，无数据时隐藏整段加入时间；为帖子列表增加明确的滚动容器和加载更多入口，或删除未使用的分页状态并明确只展示 20 条。

## Acceptance Criteria

- 有加入日期时正确显示，无日期时不出现残缺的“加入”文案。
- 超过 20 篇公开帖子时可以继续加载，且不会重复。
- `postState` 的 error/empty/loaded 分支在资料缺失时不会访问 null profile。


## Resolution (2026-07-23)

资料 DTO 返回 created_at，页面隐藏缺失日期并支持滚动加载更多帖子。
