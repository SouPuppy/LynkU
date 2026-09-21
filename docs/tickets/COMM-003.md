---
id: COMM-003
title: "Add delete with long-press gesture"
status: done
type: feature
priority: medium
autonomy: L1
parent: EPIC-003
dependencies: [COMM-001]
labels: [comments, ui, moderation]

# == Scope Contract ==
scope:
  - "Long-press on own comment triggers delete action"
  - "Show wx.showModal confirmation dialog before delete"
  - "Call deleteComment() from services/comments.ts"
  - "Remove comment from local list after successful delete"
  - "Show toast on success/error"
  - "Only show delete option on comments where author._openid === myOpenid"
  - "Admin can delete any comment (server-side check exists)"
out_of_scope:
  - "Swipe-to-delete gesture"
  - "Undo delete"
  - "Hard delete (physical removal from DB)"

# == Impact ==
affected_modules:
  - "miniprogram/components/comment-item/comment-item.ts"
  - "miniprogram/components/comment-item/comment-item.wxml"
  - "miniprogram/pages/post/post.ts"
breaking: false
data_migration: false

# == Acceptance ==
acceptance:
  - "Long-press own comment → confirmation dialog appears"
  - "Confirm → comment deleted, removed from list"
  - "Cancel → nothing happens"
  - "Long-press other user's comment → no delete option"
  - "Comment count decrements on post"


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
