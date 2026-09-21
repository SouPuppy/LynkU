---
id: FEAT-002
title: "Backend: WeChat authentication (login + JWT)"
status: superseded
type: feature
priority: high
autonomy: L2
parent: EPIC-001
dependencies: []
labels: [bbs, mvp]

# == Scope Contract ==
scope:
  - "POST /api/auth/login endpoint"
  - "WeChat code2session integration"
  - "JWT token issuance + validation"
  - "User auto-creation on first login"
  - "Auth dependency for protected routes"
  - "Token expiry and refresh flow"
out_of_scope:
  - "Admin dashboard UI"
  - "Image/file uploads"
  - "Push notifications"
  - "Group chats"
  - "Read receipts"
  - "User blocking"
  - "Email/SSO auth"

# == Impact ==
affected_modules: [be-auth-service, be-user-repo, wechat-api]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T01:51:32.526299+00:00
updated: 2026-07-21T01:51:32.526301+00:00
created_by: agent-claude
---

## Description

## Design Decisions

## Implementation Plan

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
