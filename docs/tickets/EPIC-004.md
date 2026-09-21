# EPIC-004: Diagnose Fixes — Config cleanup, dead code removal, session/auth consolidation, LoadState Behavior

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | epic |
| Priority | high |
| Parent | null |
| Design Dir | docs/design/diagnose-fixes-2026-07-23/ |
| Design Verdict | PROCEED |
| Created | 2026-07-23 |

## Scope

Apply all LOCAL_FIX and DESIGN_TRIGGER findings from `/diagnose` pipeline.

## Out of Scope

- Ponytail debt items (MONITOR_ONLY)
- New features
- Cloud function logic changes

## Child Tickets

- FIX-001: Config cleanup — gitignore, Skyline alignment, hot reload
- FIX-002: Dead code removal — login CF, unused types
- FIX-003: Session/auth consolidation — eliminate facade, unified imports, login guard, scrollToBottom
- FIX-004: LoadState Behavior — extract shared state management pattern


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
