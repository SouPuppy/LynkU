---
id: EPIC-001
title: "LynkU — UNNC Student Forum + Private Messaging Platform"
status: superseded
type: epic
priority: high
autonomy: L2
dependencies: []
labels: [bbs, wechat-miniprogram, mvp]

# == Scope Contract ==
scope:
  - "Category-based post listing + creation"
  - "Nested comments (2 levels deep)"
  - "Full-text search on posts"
  - "WeChat login (wx.login + JWT)"
  - "Real-time direct messaging (1:1) via WebSocket"
  - "Online presence indicators"
  - "Sensitive word filtering"
  - "Soft-delete for posts/comments"
  - "Cursor-based pagination"
out_of_scope:
  - "Image/file uploads in posts"
  - "Rich text editor (plain text only)"
  - "Push notifications"
  - "UNNC email/SSO verification"
  - "Group chats"
  - "Message read receipts"
  - "Admin dashboard UI"
  - "User blocking/reporting"
  - "OAuth/third-party login"

# == Impact ==
affected_modules: [mp-pages, mp-components, mp-api-client, mp-ws-client, mp-auth, be-routes, be-ws-handler, be-auth-service, be-post-service, be-comment-service, be-message-service, be-category-service, be-session-manager, be-core, be-schemas, be-models, be-user-repo, be-post-repo, be-comment-repo, be-message-repo, be-category-repo]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T01:51:32.524405+00:00
updated: 2026-07-21T01:52:05.372626+00:00
created_by: agent-claude
---

## Description

## Design Decisions

## Implementation Plan

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
