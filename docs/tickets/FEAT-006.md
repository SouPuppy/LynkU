---
id: FEAT-006
title: "Frontend: Navigation shell + auth flow"
status: superseded
type: feature
priority: high
autonomy: L2
parent: EPIC-001
dependencies: []
labels: [bbs, mvp]

# == Scope Contract ==
scope:
  - "App.ts with auth state management"
  - "Login page with WeChat one-tap flow"
  - "JWT storage and auto-injection"
  - "Tab bar navigation (Posts, Messages, Profile)"
  - "Token refresh and 401 redirect handling"
  - "Skyline + Glass-Easel baseline config"
out_of_scope:
  - "Admin dashboard UI"
  - "Image/file uploads"
  - "Push notifications"
  - "Group chats"
  - "Read receipts"
  - "User blocking"
  - "Email/SSO auth"

# == Impact ==
affected_modules: [mp-pages, mp-auth, mp-api-client]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T01:51:32.527472+00:00
updated: 2026-07-21T01:51:32.527473+00:00
created_by: agent-claude
---

## Description

## Design Decisions

## Implementation Plan

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
