# AUDIT-022: 话题圈无法跳转到已筛选的首页

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`pages/categories/categories.ts:25-28` 使用 `wx.navigateTo('/pages/index/index?category=...')`。首页是 `app.json` 中的 TabBar 页面，微信小程序不允许通过 `navigateTo` 打开 TabBar 页面。

即使改成 `switchTab`，`pages/index/index.ts:25-34` 的 `onLoad` 也不读取 `category` 参数，因此首页不会应用所选话题。

## Recommended Fix

通过全局一次性状态、事件或独立的分类帖子页传递分类；若仍复用首页，先保存待选分类，再 `switchTab`，由首页 `onShow` 消费并清理。

## Acceptance Criteria

- 点击任意话题不会触发“不能跳转到 tabbar 页面”错误。
- 首页打开后 `activeCategoryId` 与所选分类一致，并只展示该分类帖子。
- 返回/再次切换 TabBar 不会错误复用上一次的临时筛选。


## Resolution (2026-07-23)

分类页通过临时 storage + switchTab 传递筛选，首页消费后清理。
