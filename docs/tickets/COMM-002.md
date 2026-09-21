---
id: COMM-002
title: "Add reply UI to comment-item component"
status: done
type: feature
priority: high
autonomy: L1
parent: EPIC-003
dependencies: [COMM-001]
labels: [comments, ui, comment-item]

# == Scope Contract ==
scope:
  - "Add '回复' link to top-level comments in comment-item.wxml"
  - "Tapping '回复' reveals an inline reply input below that comment"
  - "Reply input has text field + send button"
  - "Submitting reply calls createComment() with parent_id set"
  - "Reply input collapses after successful submission"
  - "Only show reply link on top-level comments (depth=0), not on replies (depth=1)"
  - "Max depth enforced server-side — UI prevents reply-to-reply"
  - "Show small toast on reply success"
out_of_scope:
  - "Real-time update after reply (see COMM-004)"
  - "Reply pagination"

# == Impact ==
affected_modules:
  - "miniprogram/components/comment-item/comment-item.ts"
  - "miniprogram/components/comment-item/comment-item.wxml"
  - "miniprogram/components/comment-item/comment-item.wxss"
breaking: false
data_migration: false

# == Acceptance ==
acceptance:
  - "Each top-level comment shows a '回复' link"
  - "Tapping '回复' reveals inline input below that comment"
  - "Type text + tap send → comment created with correct parent_id"
  - "New reply appears in the replies list below the parent"
  - "Reply-to-reply is visually prevented (no '回复' on depth=1 comments)"
  - "Inline input collapses after successful submit"


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
