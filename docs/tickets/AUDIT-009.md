# AUDIT-009: `onReachBottom` not implemented on scrollable pages

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | low |
| Parent | null |
| Created | 2026-07-23 |

## Bug

Pages that use `<scroll-view>` for lists (messages notifications tab, post comments) rely on `bindscrolltolower` for pagination. But this only works if the scroll-view has explicit height. The `notif-feed` and `conv-scroll` use `calc(100vh - ...)` which is fragile on different screen sizes.

Also, the comment section on post page does NOT use scroll-view — it's a plain view with `wx:for`. Long comment threads can overflow the page.

## Fix

Ensure all scrollable content areas use `<scroll-view>` with explicit height and `bindscrolltolower` for pagination.


## Resolution (2026-07-23)

评论、消息、通知、资料列表使用显式 scroll-view 高度和分页事件。
