---
id: EPIC-003
title: "Comment System Completion — wire UI, reply, delete, real-time, cleanup"
status: done
type: epic
priority: high
autonomy: L2
parent: EPIC-002
dependencies: [CLOUD-003, CLOUD-005, CLOUD-006]
labels: [bbs, comments, ui]
design_dir: docs/design/comment-system/
design_verdict: PROCEED

# == Scope Contract ==
scope:
  - "Wire comment input bar on post page (bind send button, submit, refresh)"
  - "Reply UI in comment-item (inline reply input with parent_id)"
  - "Delete own comments via long-press + confirm dialog"
  - "Real-time comment updates via watchComments() on post page"
  - "Loading/empty/error states for comments section"
  - "Deleted comment placeholder display"
  - "Clean up stale Reply interface in comment-item.ts"
out_of_scope:
  - "Comment likes / reactions"
  - "Comment editing"
  - "Comment pagination (200 limit ok for launch)"
  - "Admin flag/hide (separate moderation feature)"
  - "Push notifications for replies"
  - "Rich text / markdown in comments"
  - "@mentions"

# == Impact ==
affected_modules:
  - "miniprogram/pages/post/*"
  - "miniprogram/components/comment-item/*"
  - "miniprogram/services/comments.ts"
  - "miniprogram/services/watch.ts"
  - "cloudfunctions/comments/index.js"
breaking: false
data_migration: false


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
