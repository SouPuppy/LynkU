---
id: FEAT-004
title: "Backend: Comments with nested threading"
status: superseded
type: feature
priority: high
autonomy: L2
parent: EPIC-001
dependencies: []
labels: [bbs, mvp]

# == Scope Contract ==
scope:
  - "Comment create/list by post endpoints"
  - "Self-referencing parent_id for threading"
  - "Max depth enforcement (2 levels)"
  - "Comment soft-delete"
  - "Comment count tracking on posts"
out_of_scope:
  - "Admin dashboard UI"
  - "Image/file uploads"
  - "Push notifications"
  - "Group chats"
  - "Read receipts"
  - "User blocking"
  - "Email/SSO auth"

# == Impact ==
affected_modules: [be-comment-service, be-comment-repo]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T01:51:32.526950+00:00
updated: 2026-07-21T01:51:32.526951+00:00
created_by: agent-claude
---

## Description

## Design Decisions

## Implementation Plan

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
