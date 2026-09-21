---
id: FEAT-005
title: "Backend: WebSocket messaging infrastructure"
status: superseded
type: feature
priority: high
autonomy: L2
parent: EPIC-001
dependencies: []
labels: [bbs, mvp]

# == Scope Contract ==
scope:
  - "WebSocket endpoint /ws with JWT auth"
  - "Session manager (connect/disconnect/online tracking)"
  - "Real-time message delivery + ACK protocol"
  - "Offline message persistence and delivery"
  - "Message idempotency (dedup by msg_id)"
  - "Conversation listing and history"
out_of_scope:
  - "Admin dashboard UI"
  - "Image/file uploads"
  - "Push notifications"
  - "Group chats"
  - "Read receipts"
  - "User blocking"
  - "Email/SSO auth"

# == Impact ==
affected_modules: [be-ws-handler, be-message-service, be-session-manager, be-message-repo]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T01:51:32.527218+00:00
updated: 2026-07-21T01:51:32.527219+00:00
created_by: agent-claude
---

## Description

## Design Decisions

## Implementation Plan

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
