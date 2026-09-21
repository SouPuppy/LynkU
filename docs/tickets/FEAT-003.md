---
id: FEAT-003
title: "Backend: Category + Post CRUD with search"
status: superseded
type: feature
priority: high
autonomy: L2
parent: EPIC-001
dependencies: []
labels: [bbs, mvp]

# == Scope Contract ==
scope:
  - "Category list/create endpoints"
  - "Post create/read/list endpoints"
  - "Cursor-based pagination"
  - "Full-text search via PostgreSQL TSVECTOR"
  - "Sensitive word filter"
  - "Post soft-delete and status workflow"
  - "Rate limiting on post creation"
out_of_scope:
  - "Admin dashboard UI"
  - "Image/file uploads"
  - "Push notifications"
  - "Group chats"
  - "Read receipts"
  - "User blocking"
  - "Email/SSO auth"

# == Impact ==
affected_modules: [be-post-service, be-category-service, be-post-repo, be-category-repo]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T01:51:32.526637+00:00
updated: 2026-07-21T01:51:32.526639+00:00
created_by: agent-claude
---

## Description

## Design Decisions

## Implementation Plan

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
