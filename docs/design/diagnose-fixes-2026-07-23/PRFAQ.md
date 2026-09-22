# PR/FAQ: Diagnose Fixes (2026-07-23)

## Problem

The `/diagnose` pipeline identified 10 findings across the LynkU codebase:
2 critical config issues, 6 warnings (dead code, inconsistency, duplication),
and 2 notes. Left unfixed, these cause:

- Developer environment inconsistency (Skyline on/off mismatch between devs)
- Confusing dual import paths for session/auth (13 call sites)
- ~600 lines of duplicated LoadState boilerplate across 12 pages
- Dead code in production (deprecated cloud function, unused types)
- Broken chat UX (scrollToBottom stub)
- New developers get no hot reload by default

## Solution

Apply all 8 LOCAL_FIX items in a single pass, plus 1 DESIGN_TRIGGER item
(LoadState Behavior extraction). Grouped into 4 work units:

1. **Config cleanup** (C-001, C-002, W-006): gitignore private config, align Skyline, enable hot reload
2. **Dead code removal** (W-004, W-005): delete login cloud function, delete unused types
3. **Session/auth consolidation** (W-001, W-003): eliminate auth.ts facade, unify on session.ts, extract login guard helper
4. **LoadState Behavior** (W-002): extract shared LoadState management into a WeChat Behavior

N-001 (ponytail debt) is MONITOR_ONLY — no action. N-002 (scrollToBottom) bundled into work unit 3.

## Customer Quote

> "I cloned the repo and Skyline was broken. Then I enabled it and the nav bar
> disappeared. Also, why do some files import from `auth` and others from `session`?"

## Scope

| In Scope | Out of Scope |
|----------|-------------|
| C-001: .gitignore private.config | Ponytail debt items (N-001) |
| C-002: Align Skyline config | Refactoring page UI (cosmetic) |
| W-001: Consolidate auth/session imports | Adding new features |
| W-002: LoadState Behavior | Changing cloud function logic |
| W-003: Login guard helper | Migration off CloudBase |
| W-004: Delete deprecated login CF | |
| W-005: Delete unused types | |
| W-006: Enable hot reload in project config | |
| N-002: Implement scrollToBottom | |

## FAQ

**Q: Why not merge auth.ts into session.ts entirely?**
A: `auth.ts`'s `ensureLogin()` function is the only thing that calls the users cloud function for login. Moving it to `session.ts` would give session a cloud function dependency. Keep the split clean: `session.ts` = cache, `auth.ts` = just `ensureLogin()`.

**Q: What is a WeChat Behavior?**
A: A mixin/trait pattern native to WeChat Mini Programs. `Component` and `Page` can both use Behaviors to share data, methods, and lifecycle hooks. No new dependency needed.

**Q: Does LoadState Behavior work with both Component and Page?**
A: Yes. WeChat Behaviors are compatible with both. The Behavior defines `data` (state, errorMsg) and `methods` (setLoading, setLoaded, setEmpty, setError).

**Q: What about N-002 (scrollToBottom)?**
A: Trivial fix — add `scroll-into-view` on the last message element. Bundled with session/auth consolidation since the chat page is one of the import sites.
