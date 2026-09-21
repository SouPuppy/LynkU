---
id: COMM-001
title: "Wire comment input bar on post page"
status: done
type: feature
priority: high
autonomy: L1
parent: EPIC-003
dependencies: []
labels: [comments, ui, post-page]

# == Scope Contract ==
scope:
  - "Bind send button in post.wxml to submitComment handler"
  - "Add inputValue state to post.ts for the comment input"
  - "Call createComment() from services/comments.ts on submit"
  - "Refresh comment list after successful post"
  - "Disable send button while loading"
  - "Clear input after successful post"
  - "Show toast on error"
out_of_scope:
  - "Reply input (see COMM-002)"
  - "Real-time updates (see COMM-004)"

# == Impact ==
affected_modules:
  - "miniprogram/pages/post/post.ts"
  - "miniprogram/pages/post/post.wxml"
breaking: false
data_migration: false

# == Acceptance ==
acceptance:
  - "User can type text in comment input bar"
  - "Tapping send calls the cloud function and creates a comment"
  - "Comment list refreshes and shows the new comment"
  - "Input clears and send button re-enables after success"
  - "Error toast appears on failure"


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
