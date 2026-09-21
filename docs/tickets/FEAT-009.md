---
id: FEAT-009
title: "Frontend: Backend environment config (dev/prod URL switch)"
status: superseded
type: feature
priority: medium
autonomy: L2
parent: EPIC-001
dependencies: []
labels: [mp-api-client, config]

# == Scope Contract ==
scope:
  - "Add backendEnv + backendUrls to app.globalData / IAppOption"
  - "api.ts reads backendEnv to resolve BASE_URL instead of hardcoded string"
  - "Default env: dev → http://127.0.0.1:1888"
  - "Prod URL: https://api.lucky.university"
out_of_scope:
  - "UI for switching backends"
  - "Separate config file"
  - "Build-time env detection"
  - "More than two environments"

# == Impact ==
affected_modules: [mp-api-client]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T02:00:00.000000+00:00
updated: 2026-07-21T02:00:00.000000+00:00
created_by: agent-claude
---

## Description

Replace the hardcoded BASE_URL in api.ts with an environment-aware lookup.
app.globalData holds the selected environment key; api.ts resolves it to
the actual URL from a map.

## Design Decisions

- Map in app.ts, not a separate config file — two URLs, one place to edit.
- No UI — dev workflow is: edit one string in app.ts, recompile.
- Mock mode unchanged — isMock=true skips realRequest, URL is irrelevant.

## Implementation Plan

1. Add type + data to app.ts
2. Replace hardcoded BASE_URL in api.ts with lookup from app.globalData

## Evidence

## Final Summary


## Disposition (2026-07-23)

该票据属于已被 CloudBase/当前资料页架构取代的历史方案，保留用于追溯，不再按旧实现部署。
