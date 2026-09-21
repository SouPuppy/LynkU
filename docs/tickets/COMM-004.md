---
id: COMM-004
title: "Integrate real-time comment watch on post page"
status: done
type: feature
priority: medium
autonomy: L1
parent: EPIC-003
dependencies: [COMM-001]
labels: [comments, real-time, watch]

# == Scope Contract ==
scope:
  - "Start watchComments() on post page onShow / onLoad"
  - "Stop watcher on page onHide / onUnload to avoid leaks"
  - "On snapshot change, rebuild comment tree and update page data"
  - "Handle watch error gracefully (fall back to static list)"
  - "Do NOT re-trigger watch on local changes (avoid double-render: local add + watch callback)"
out_of_scope:
  - "Real-time for replies beyond what watch() provides"
  - "Optimistic UI updates"
  - "Conflict resolution for simultaneous edits"

# == Impact ==
affected_modules:
  - "miniprogram/pages/post/post.ts"
  - "miniprogram/services/watch.ts"
breaking: false
data_migration: false

# == Acceptance ==
acceptance:
  - "New comments from other users appear without manual refresh"
  - "Deleted comments disappear in real time"
  - "Watcher stops when leaving the post page"
  - "Watcher restarts when returning to the post page"
  - "Error in watcher does not crash the page"


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
