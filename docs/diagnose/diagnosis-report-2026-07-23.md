# Diagnosis Report — LynkU

**Date**: 2026-07-23
**Scope**: Full project (miniprogram + cloudfunctions)
**Pipeline**: Phase 1 (Topology) → Phase 2 (Diagnosis) → Phase 3 (Calibration) → Phase 4 (Report)

---

## Phase 1: Topology Model Summary

WeChat Mini Program BBS (forum + messaging) with CloudBase backend.

| Layer | Module Count | LOC |
|-------|-------------|-----|
| Pages | 12 | ~1,100 |
| Components | 11 | ~310 |
| Services | 13 | ~680 |
| Utils | 1 | 37 |
| Cloud Functions | 7 | ~600 |
| **Total** | **44** | **~2,700** |

**Architecture**: 3-tier — Page → Service → CloudBase (DB read) / Cloud Function (write).
Service layer is clean: each service owns one domain (posts, comments, messages, etc.).
Cloud functions use shared `common/index.js` (deployed as per-function copies — platform constraint).

---

## Phase 2+3: Diagnostic Findings

### [CRITICAL] C-001: project.private.config.json tracked by git

**Dimension**: Security / Configuration
**Location**: `project.private.config.json`
**Evidence**: `git ls-files` shows it tracked. This file contains personal DevTools settings.
**Calibration**: WeChat docs state this file is for personal overrides and should NOT be committed.
**Impact**: Developer-specific settings leak between team members.
**Action**: `LOCAL_FIX`

---

### [CRITICAL] C-002: Config conflict — Skyline enabled in project but disabled locally

**Dimension**: Inconsistency
**Location**: `project.config.json:51` vs `project.private.config.json:9`
**Evidence**:
- `project.config.json`: `"renderer": "skyline"`, `"componentFramework": "glass-easel"`, `"skylineRenderEnable": true`
- `project.private.config.json`: `"skylineRenderEnable": false`
- `miniprogram/app.json`: `"renderer": "skyline"`, custom nav-bar component designed for Skyline

**Calibration**: The user's DevTools warning ("Due to the custom navigationStyle of the Skyline page...") is caused by Skyline being enabled at the project level but disabled locally. The `nav-bar` component is designed for Skyline (custom navigation), but when Skyline is off, the `app.json` window config (`navigationBarTitleText: "Lucky"`) is used instead. This mismatch explains both warnings in the user's DevTools.

**Impact**: Confusing development experience. Components may behave differently between developers.
**Action**: `LOCAL_FIX` — align Skyline setting. Either enable it globally or disable it consistently.

---

### [WARNING] W-001: Auth/session import inconsistency across pages

**Dimension**: Inconsistency
**Location**: 13 files
**Evidence**:
- `pages/{index,messages,drafts,notifications,login}`: import `isLoggedIn` from `../../services/auth`
- `pages/{profile,settings,my-posts}`: import `* as session` from `../../services/session` AND import from `../../services/auth`
- `pages/post`: imports `getOpenid` from `../../services/auth`
- `subpkg-chat/pages/chat`: imports `getOpenid` from `../../../services/auth`

`auth.ts` re-exports `session.get`, `session.getOpenid`, `session.isLoggedIn`, `session.logout` — a thin facade. Some pages go through `auth`, others call `session` directly. This splits what should be a single entry point.

**Calibration**: Standard practice is to have ONE canonical import path. The `auth.ts` facade exists for "backward compatibility" but the codebase is young — no legacy consumers.

**Impact**: Confusion about which module owns the session API. New pages pick inconsistently.
**Action**: `LOCAL_FIX` — pick one (recommend: delete `auth.ts` re-exports, have pages import `session` directly, keep `ensureLogin` in `auth.ts` or move to `users.ts`).

---

### [WARNING] W-002: LoadState boilerplate duplicated across 12 pages

**Dimension**: Under-Abstraction
**Location**: All 12 page files
**Evidence**: Every page manually manages a `state: 'idle' | 'loading' | 'loaded' | 'empty' | 'error'` cycle with identical `setData` calls. Pattern:
```
this.setData({ state: 'loading' })
try { ...; this.setData({ state: 'loaded' }) }
catch (_) { this.setData({ state: 'error' }) }
```
~50 lines per page x 12 pages = ~600 lines of duplicated state management.

**Calibration**: WeChat Mini Programs support `Behavior` (mixin pattern) for shared logic. A `LoadableBehavior` would eliminate this duplication. However, a Behavior introduces indirection — trade-off.

**Impact**: Bug risk: some pages show error messages, others don't. Inconsistent UX on failure.
**Action**: `DESIGN_TRIGGER` — extracting a shared pattern touches >3 files and introduces a new abstraction. Worth doing but needs design.

---

### [WARNING] W-003: isLoggedIn guard duplicated across 6+ pages

**Dimension**: Under-Abstraction
**Location**: `pages/{index,messages,drafts,notifications,profile,login}.ts`
**Evidence**: 6 pages check `isLoggedIn()` in `onShow()` and redirect to `/pages/login/login`. Identical 3-line pattern each time:
```
if (!isLoggedIn()) {
  wx.redirectTo({ url: '/pages/login/login' })
  return
}
```

**Calibration**: WeChat Mini Programs don't have route guards natively. The pattern is common in real-world mini programs.

**Impact**: Adding a new page requires remembering to add this guard. Forgetting means unauthenticated access.
**Action**: `LOCAL_FIX` — extract to a simple helper function or Behavior. Touches ≤3 files (new util + existing pages).

---

### [WARNING] W-004: cloudfunctions/login/ — deprecated dead code

**Dimension**: Over-Abstraction / Dead Code
**Location**: `cloudfunctions/login/index.js:2`
**Evidence**: Comment says "Deprecated: will be removed after client migration to cf-users.ensure." Client code (`auth.ts`) calls `callCloud('users', ...)`, never `callCloud('login', ...)`. No client references to the login cloud function.

**Calibration**: Dead code that was marked for removal but wasn't.

**Impact**: Deployment overhead (extra cloud function to deploy), confusion for new developers.
**Action**: `LOCAL_FIX` — delete the cloud function.

---

### [WARNING] W-005: Unused type definitions

**Dimension**: Over-Abstraction / Dead Code
**Location**: `miniprogram/typings/cloudbase.d.ts:133-155`
**Evidence**: `ApiResult<T>` and `CloudResult<T>` are defined but grep confirms zero usages in non-definition files. `CloudError` is also unused (the `CloudCallError` class in `cloud.ts` doesn't reference it).

**Calibration**: Dead types bloat the type surface.

**Impact**: Low — unused types don't affect runtime. But they mislead readers.
**Action**: `LOCAL_FIX` — delete unused types.

---

### [WARNING] W-006: Hot reload disabled in project config

**Dimension**: Configuration
**Location**: `project.config.json:21`
**Evidence**: `"compileHotReLoad": false` in shared project config. The private config overrides this to `true`, but any developer without a private config gets no hot reload.

**Calibration**: Hot reload is essential for development velocity. WeChat DevTools supports it natively.

**Impact**: New developers cloning the repo won't get hot reload unless they create a private config.
**Action**: `LOCAL_FIX` — set `compileHotReLoad: true` in project.config.json.

---

### [NOTE] N-001: Ponytail debt ledger (8 items)

| ID | File | Ceiling | Upgrade Path |
|----|------|---------|--------------|
| D-1 | `utils/util.ts:2` | date formatting | add date-fns/moment if these grow unwieldy |
| D-2 | `services/comments.ts:14` | 200 comments/post | add pagination if posts routinely exceed this |
| D-3 | `cloudfunctions/posts/index.js:8` | in-memory rate limit | use DB counter if persistence needed |
| D-4 | `cloudfunctions/messages/index.js:73` | ~100 conversations | paginate peer fetch |
| D-5 | `cloudfunctions/messages/index.js:97` | before cursor | determine _id vs timestamp pagination when needed |
| D-6 | `subpkg-chat/pages/chat/chat.ts:113` | scrollToBottom stub | use scroll-view scroll-into-view |
| D-7 | `components/nav-bar/nav-bar.ts:9` | safe defaults | hardcoded iPhone 14 heights as fallback |
| D-8 | `cloudfunctions/users/index.js:26` | transient read errors | handle gracefully |

**Status**: All MONITOR_ONLY. None have triggered their ceilings yet.

---

### [NOTE] N-002: scrollToBottom() is a stub

**Dimension**: Under-Abstraction / Missing Implementation
**Location**: `miniprogram/subpkg-chat/pages/chat/chat.ts:112-114`
**Evidence**: Method body is empty with a `ponytail:` comment. Chat messages don't auto-scroll to bottom.
**Impact**: UX broken in chat — new messages appear off-screen.
**Action**: `LOCAL_FIX` — implement with `scroll-view` + `scroll-into-view`.

---

## Classification Summary

| ID | Severity | Action | Files Touched |
|----|----------|--------|---------------|
| C-001 | CRITICAL | LOCAL_FIX | 1 (.gitignore) |
| C-002 | CRITICAL | LOCAL_FIX | 2 (config files) |
| W-001 | WARNING | LOCAL_FIX | ~10 (pages) |
| W-002 | WARNING | DESIGN_TRIGGER | >12 (pages + new behavior) |
| W-003 | WARNING | LOCAL_FIX | ~8 (pages + new helper) |
| W-004 | WARNING | LOCAL_FIX | 1 (delete dir) |
| W-005 | WARNING | LOCAL_FIX | 1 (types file) |
| W-006 | WARNING | LOCAL_FIX | 1 (project.config.json) |
| N-001 | NOTE | MONITOR_ONLY | 0 |
| N-002 | NOTE | LOCAL_FIX | 1 (chat.ts) |

- **LOCAL_FIX**: 8 items
- **DESIGN_TRIGGER**: 1 item (W-002)
- **MONITOR_ONLY**: 1 item (N-001)

---

## HARD STOP — Awaiting Human Confirmation

Which items should I act on?

**Recommendation**:
- Apply all LOCAL_FIX items immediately (8 items, ~20 files touched total)
- Defer W-002 (LoadState extraction) to a separate `/design` pass
- N-001 (ponytail debt) is MONITOR_ONLY — no action needed now
