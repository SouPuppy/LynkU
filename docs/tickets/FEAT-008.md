---
id: FEAT-008
title: "Frontend: Real-time messaging UI"
status: superseded
type: feature
priority: high
autonomy: L2
parent: EPIC-001
dependencies: []
labels: [bbs, mvp]

# == Scope Contract ==
scope:
  - "WebSocket client with state machine + reconnection"
  - "Conversation list page"
  - "Chat room page with message bubbles"
  - "Online presence indicators"
  - "Message send with sending/sent/failed status"
  - "Offline message queue + retry"
out_of_scope:
  - "Admin dashboard UI"
  - "Image/file uploads"
  - "Push notifications"
  - "Group chats"
  - "Read receipts"
  - "User blocking"
  - "Email/SSO auth"

# == Impact ==
affected_modules: [mp-pages, mp-components, mp-ws-client]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T01:51:32.528049+00:00
updated: 2026-07-21T01:51:32.528050+00:00
created_by: agent-claude
---

## Description

## Design Decisions

## Implementation Plan

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
