---
id: COMM-005
title: "Cleanup comment types, states, and edge cases"
status: done
type: feature
priority: medium
autonomy: L1
parent: EPIC-003
dependencies: []
labels: [comments, cleanup, types]

# == Scope Contract ==
scope:
  - "Remove stale local Reply interface from comment-item.ts"
  - "Use IComment type from typings/cloudbase.d.ts consistently"
  - "Add loading state for comments section (skeleton or spinner)"
  - "Add empty state ('暂无评论，来抢沙发吧')"
  - "Add error state with retry button"
  - "Handle deleted comments: show '[评论已删除]' placeholder"
  - "Deleted parent comments still show their non-deleted replies"
  - "Wire LoadState for commentState in post.ts"
out_of_scope:
  - "Type generation from DB schema"
  - "Comment sorting options (newest/oldest)"

# == Impact ==
affected_modules:
  - "miniprogram/components/comment-item/comment-item.ts"
  - "miniprogram/pages/post/post.ts"
  - "miniprogram/pages/post/post.wxml"
breaking: false
data_migration: false

# == Acceptance ==
acceptance:
  - "Stale Reply interface is removed, IComment used throughout"
  - "Comments section shows skeleton while loading"
  - "'暂无评论' shown when post has 0 comments"
  - "Error state shown with retry when load fails"
  - "Deleted comments show '[评论已删除]' with their replies visible"
  - "No TypeScript errors from mismatched types"


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
