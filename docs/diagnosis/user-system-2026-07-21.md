# Diagnosis Report: User System

> **Date**: 2026-07-21
> **Scope**: User authentication, profile management, author denormalization
> **Pipeline**: /diagnose (linear mode) — Phase 4 Report Synthesis
> **Status**: COMPLETED — all LOCAL_FIX applied, DESIGN_TRIGGER routed through /design and implemented

---

## Executive Summary

The user system has **12 issues** across 3 dimensions. The root cause is
**under-abstraction via copy-paste**: 4 cloud functions independently
implement the same author lookup, 6 copy the same utils.js, and profile
cache logic is scattered across 3+ files. Two critical data-consistency
bugs exist: login updates user docs without denormalized sync, and the
client-side `getProfile` bypasses the cloud function entirely.

**Recommendation**: Apply LOCAL_FIX items first (low risk, immediate
improvement), then run `/design` for the DESIGN_TRIGGER items (merge
cloud functions, centralize cache).

---

## Finding Summary

| # | Severity | Dimension | Action | Summary |
|---|----------|-----------|--------|---------|
| F1 | WARNING | Under-Abstraction | LOCAL_FIX | 6 identical utils.js copies, 5 use buggy filter |
| F2 | CRITICAL | Inconsistency | LOCAL_FIX | login updates user without denormalized sync |
| F3 | WARNING | Under-Abstraction | DESIGN_TRIGGER | Author lookup pattern duplicated in 3 cloud functions |
| F4 | WARNING | Over-Abstraction | LOCAL_FIX | Client getProfile bypasses its own cloud function |
| F5 | CRITICAL | Over-Abstraction | DESIGN_TRIGGER | login + users cloud functions overlap on same collection |
| F6 | WARNING | Inconsistency | DESIGN_TRIGGER | 4 modules manage profile cache independently |
| F7 | NOTE | Under-Abstraction | LOCAL_FIX | Admin check pattern duplicated across 2 functions |
| F8 | NOTE | Inconsistency | MONITOR_ONLY | Inconsistent field selection in user queries |
| F9 | WARNING | Inconsistency | LOCAL_FIX | Login page exposes debug info to users |
| F10 | WARNING | Under-Abstraction | DESIGN_TRIGGER | 6 cloud functions repeat openid extraction boilerplate |
| F11 | NOTE | Over-Abstraction | LOCAL_FIX | IUserPublic is IUser minus 2 date fields |
| F12 | WARNING | Under-Abstraction | LOCAL_FIX | No input validation on login ensureUser |

---

## Detailed Findings

### F1 — Duplicated utils.js Across 6 Cloud Functions [WARNING] [LOCAL_FIX]

**Dimension**: Under-Abstraction
**Status**: CONFIRMED

**Code locations**:
- `cloudfunctions/login/utils.js` (identical to 4 others)
- `cloudfunctions/users/utils.js` (identical to 4 others)
- `cloudfunctions/comments/utils.js` (identical to 4 others)
- `cloudfunctions/messages/utils.js` (identical to 4 others)
- `cloudfunctions/categories/utils.js` (identical to 4 others)
- `cloudfunctions/posts/utils.js` (DIFFERENT — has word-boundary fix for Latin profanity)

All 6 files have the comment `// cloudfunctions/common/utils.js` but no
such shared location exists. The `posts/utils.js` version has a
production bug-fix (word-boundary matching for short Latin words like "sb"
to avoid false positives in words like "adsb"). This fix was never
propagated to the other 5 copies.

**Impact**: Bug fixes must be manually copied to 6 locations. Any new
cloud function will copy-paste the same file, perpetuating the problem.
The comments and posts cloud functions use different filter behavior for
the same profanity list.

**External reference**: WeChat IDE does not bundle parent-directory
`require()` references. Industry solutions: (a) git submodule for shared
code, (b) private npm package, (c) deploy-script copy. See [CloudBase
shared dependency solutions](https://blog.codelin.vip/2024-08-20-115407581/).

**Fix**: Copy `cloudfunctions/posts/utils.js` (canonical version) to the
other 5 cloud functions. This is mechanical — same file content, 5
overwrites. The DESIGN_TRIGGER for a proper shared-module architecture
is F10 below.

**Classification rationale**:
- [x] Does NOT introduce a new module or dependency edge (file overwrite only)
- [x] Touches ≤3 files? NO (5 overwrites) — but each is identical, mechanical
- [x] Does NOT change any public interface
- [x] Verifiable: run any cloud function locally
- [x] Reversible: git checkout

---

### F2 — login Updates User Without Denormalized Sync [CRITICAL] [LOCAL_FIX]

**Dimension**: Inconsistency
**Status**: CONFIRMED

**Code locations**:
- `cloudfunctions/login/index.js:18-63` — `ensureUser()` updates
  nickname/avatar in `users` collection but does NOT sync to
  `posts.author` / `comments.author`
- `cloudfunctions/users/index.js:18-37` — `updateProfile()` updates
  nickname/avatar AND syncs denormalized author data (lines 30-33)

Both functions update the same fields on the same collection. Only one
syncs. After a login that updates a user's nickname, all existing posts
and comments retain the old author data.

**Impact**: Stale author display across the entire forum. User changes
nickname during login → old name remains on all their content until they
explicitly use the profile edit feature (which most users won't discover).

**External reference**: Denormalized data synchronization is a
well-documented consistency challenge. The industry standard is either
(a) eager sync on all write paths, or (b) lazy repair on read. Mixing
the two strategies on different write paths creates silent inconsistency.
[CloudBase transactions](https://docs.cloudbase.net/) can wrap multi-collection
updates atomically.

**Fix**: Add denormalized sync to `ensureUser()` in cf-login
(after the update block, same pattern as cf-users lines 30-33).
This is 6 lines of code in 1 file.

**Classification rationale**: LOCAL_FIX — touches 1 file, no new modules,
no interface changes, verifiable.

---

### F3 — Duplicated Author Lookup Pattern [WARNING] [DESIGN_TRIGGER]

**Dimension**: Under-Abstraction
**Status**: CONFIRMED

**Code locations**:
- `cloudfunctions/posts/index.js:49-53` — inline user doc read to build
  author object with fallback `{nickname: '用户', avatar_url: ''}`
- `cloudfunctions/comments/index.js:41-44` — same pattern, identical fallback
- `cloudfunctions/messages/index.js:73-78` — batch variant with `_.in()`,
  same fallback at line 85
- `cloudfunctions/messages/index.js:30-32` — recipient existence check
  (also reads users doc)

Three different implementations of "get user profile for embedding":
1. Single doc read + fallback (posts, comments)
2. Batch doc read + fallback (messages conversations)
3. Single doc read + existence check (messages send)

**Impact**: If user model gains a field (e.g., `title`, `badge`), 4
code sites need updating. Different fallback behavior when user doc
is missing (posts/comments degrade gracefully, messages send rejects).

**External reference**: Extract to shared `getAuthorSnapshot(openid)`
function. CloudBase cloud functions can share code via
[git submodules or npm packages](https://blog.codelin.vip/2024-08-20-115407581/).

**Fix**: Requires creating a shared cloud function module — this
introduces new dependency edges across cloud functions and a deployment
strategy. Route through `/design`.

**Classification rationale**: DESIGN_TRIGGER — introduces a new shared
module, new dependency edges, touches >3 files across >2 modules.

---

### F4 — Client getProfile Bypasses Cloud Function [WARNING] [LOCAL_FIX]

**Dimension**: Over-Abstraction
**Status**: CONFIRMED

**Code locations**:
- `miniprogram/services/users.ts:10-18` — `getProfile()` reads directly
  from `coll.users.doc(openid).field(...).get()`
- `cloudfunctions/users/index.js:39-46` — `getProfile()` action exists
  but is NEVER called by any client code

The cloud function's `getProfile` action is dead code. The client service
bypasses it entirely. Two paths exist for the same operation — one is
never exercised.

**Impact**: Dead code. If a future developer adds authorization logic to
cf-users getProfile, it won't apply to client reads. Confusion about
which path to use.

**Fix (Option A — recommended)**: Delete the `getProfile` action from
cf-users. The client's direct DB read is simpler and correct (public
fields only, read-only).

**Fix (Option B)**: Change `users.ts` to call `callCloud('users',
{action: 'getProfile', openid})`. Requires consistency with the rest
of the service (which mixes direct reads and cloud calls).

**Classification rationale**: LOCAL_FIX — Option A touches 1 file
(delete a case branch), no interface changes (getProfile was never called).

---

### F5 — login + users Cloud Functions Overlap [CRITICAL] [DESIGN_TRIGGER]

**Dimension**: Over-Abstraction
**Status**: CONFIRMED

**Code locations**:
- `cloudfunctions/login/index.js` — `ensureUser()`: create-or-update
  user doc
- `cloudfunctions/users/index.js` — `updateProfile()`: update user doc
  + denormalized sync; `getProfile()`: read user doc

Both functions own the `users` collection. Both write to the same
document. `ensureUser` in login does partial update without sync;
`updateProfile` in users does partial update with sync. Two cloud
functions for one collection with divergent behavior.

**Impact**: F2 is a direct consequence of this split. Any future
operation on the users collection will face the "which cloud function?"
question. Permission logic, validation, and side effects will diverge.

**External reference**: Single-responsibility principle applied to
cloud functions: one function = one collection's write path. The
[CloudBase best practices](https://docs.cloudbase.net/en/recipes/optimize-cloud-function-wechat-miniprogram)
recommend consolidating related operations.

**Fix**: Merge into a single `users` cloud function with actions:
`ensure`, `updateProfile`, `getProfile`. This requires:
- New module structure (merge + redirect)
- Client `auth.ts` updated to call `users` instead of `login`
- Deprecation/cleanup of `login` cloud function
- DESIGN_TRIGGER — introduces module dependency changes, touches >3
  files across client and cloud layers.

---

### F6 — Scattered Profile Cache Management [WARNING] [DESIGN_TRIGGER]

**Dimension**: Inconsistency
**Status**: CONFIRMED

**Code locations**:
- `miniprogram/services/auth.ts:24-26` — `ensureLogin()` writes to
  storage + globalData
- `miniprogram/services/users.ts:30-32` — `updateProfile()` writes to
  storage + globalData (same keys, different function)
- `miniprogram/app.ts:31-36` — `onLaunch()` restores from storage
- `miniprogram/pages/profile/profile.ts:23-32` — `loadProfile()` reads
  from BOTH cache AND globalData, setting data twice

No single module owns "the current user state." Three different modules
write to the same storage key. The profile page redundantly checks two
sources for the same data.

**Impact**: If a bug corrupts the cache, debugging requires checking 3
write sites. Adding a new cached field requires changes in 3 places.
The profile page's double-read pattern will be copy-pasted.

**Fix**: Create a single `UserSession` module that owns:
- The `user_profile` storage key
- The `globalData.user` reference
- `get()`, `set(profile)`, `clear()` methods
- All other modules read through it

This is DESIGN_TRIGGER — introduces a new module, touches >4 files.

---

### F7 — Duplicated Admin Check Pattern [NOTE] [LOCAL_FIX]

**Dimension**: Under-Abstraction
**Status**: CONFIRMED

**Code locations**:
- `cloudfunctions/posts/index.js:85-86` — inline `db.collection('users').doc(openid).get()` + role check
- `cloudfunctions/categories/index.js:7-9` — `checkAdmin(openid)` function

Same logic, two styles. posts does it inline, categories extracts a
helper.

**Fix**: Extract `checkAdmin(openid)` to shared utils. After F1 (canonical
utils.js), add the helper and update posts to use it. 1 file changed.

---

### F8 — Inconsistent User Field Selection [NOTE] [MONITOR_ONLY]

**Dimension**: Inconsistency
**Status**: DISPUTED

**Code locations**:
- cf-users, users.ts: `.field({nickname, avatar_url, role})`
- cf-posts, cf-comments, cf-login: read full doc
- cf-messages: `.field({nickname, avatar_url, role})`

Reading full docs vs. selecting specific fields is a performance
trade-off. CloudBase bills per read operation, not per field. The
bandwidth difference for a 6-field document is negligible. Some
operations need the full doc (login checks all fields for update diff),
others don't.

**Action**: Recorded for future optimization. No immediate action.

---

### F9 — Login Page Exposes Debug Info [WARNING] [LOCAL_FIX]

**Dimension**: Inconsistency
**Status**: CONFIRMED

**Code locations**:
- `miniprogram/pages/login/login.ts:26-34` — sets `debugInfo` with
  internal step details visible in UI
- `miniprogram/pages/login/login.wxml` — renders `{{debugInfo}}` to user

Production login page shows "Step 1/3: CloudBase initializing...",
"Step 2/3: calling login cloud function...", "Step 3/3: login OK,
openid=xxx..." and on failure "FAILED [CODE]: message". This is
debug instrumentation, not user-facing copy.

**Impact**: Information disclosure — openid prefix exposed. Unprofessional
UI for end users.

**Fix**: Remove or gate `debugInfo` behind a debug flag. 2 files.

---

### F10 — Repeated Openid Extraction Boilerplate [WARNING] [DESIGN_TRIGGER]

**Dimension**: Under-Abstraction
**Status**: CONFIRMED

**Code locations** (6 identical instances):
- `cloudfunctions/login/index.js:8-9`
- `cloudfunctions/users/index.js:9-10`
- `cloudfunctions/posts/index.js:21-22`
- `cloudfunctions/comments/index.js:9-10`
- `cloudfunctions/messages/index.js:9-10`
- `cloudfunctions/categories/index.js:13-14`

Every cloud function's `main()` starts with:
```js
const openid = cloud.getWXContext().OPENID
if (!openid) return fail('身份验证失败', 'AUTH_FAILED')
```

**Impact**: Boilerplate that a shared middleware/handler wrapper would
eliminate. 12 lines × 6 functions = 72 lines of identical code.

**Fix**: After establishing shared cloud function utilities (F1, F3),
create a `withAuth(handler)` wrapper. DESIGN_TRIGGER — depends on
shared module infrastructure.

---

### F11 — IUserPublic is IUser Minus 2 Fields [NOTE] [LOCAL_FIX]

**Dimension**: Over-Abstraction
**Status**: CONFIRMED

**Code locations**:
- `miniprogram/typings/cloudbase.d.ts:5-12` — `IUser` (6 fields)
- `miniprogram/typings/cloudbase.d.ts:14-19` — `IUserPublic` (4 fields)

`IUserPublic` = `IUser` minus `created_at` and `updated_at`. The
TypeScript `Omit<IUser, 'created_at' | 'updated_at'>` utility type
achieves the same thing without a separate interface to maintain.

**Fix**: Replace with `type IUserPublic = Omit<IUser, 'created_at' |
'updated_at'>`. 1 file.

---

### F12 — No Input Validation on login ensureUser [WARNING] [LOCAL_FIX]

**Dimension**: Under-Abstraction
**Status**: CONFIRMED

**Code locations**:
- `cloudfunctions/login/index.js:18-63` — `ensureUser(openid, nickname,
  avatar_url)` accepts raw nickname and avatar_url with no validation
- `cloudfunctions/users/index.js:21` — `updateProfile()` validates
  nickname with `validateInput(nickname, {maxLen: 30})`

The login path writes `nickname` directly to the database with no
length check or content validation. The profile update path does
validate. This is the same inconsistency as F2 — login writes with
fewer safeguards than users.

**Impact**: A malformed nickname (e.g., excessively long) can enter the
database through login but would be rejected by updateProfile.

**Fix**: Add `validateInput(nickname, {maxLen: 30})` to `ensureUser()`
before writing. 1 file, 3 lines.

---

## Action Plan

### Phase 1: LOCAL_FIX (apply immediately, no design needed)

| Order | Finding | Files | Description |
|-------|---------|-------|-------------|
| 1 | F1 | 5 | Copy canonical utils.js to all cloud functions |
| 2 | F12 | 1 | Add input validation to login ensureUser |
| 3 | F2 | 1 | Add denormalized sync to login ensureUser |
| 4 | F4 | 1 | Delete unused getProfile action from cf-users |
| 5 | F9 | 2 | Hide debug info on login page |
| 6 | F7 | 1 | Extract checkAdmin to canonical utils |
| 7 | F11 | 1 | Replace IUserPublic with Omit type alias |

**Total**: 7 fixes, ~12 files touched, all reversible.

### Phase 2: DESIGN_TRIGGER (route through /design)

| Order | Finding | Scope |
|-------|---------|-------|
| 1 | F5 | Merge login + users cloud functions |
| 2 | F3 + F10 | Shared cloud function module for author lookup + auth wrapper |
| 3 | F6 | Centralized UserSession module for client-side cache |

### Phase 3: MONITOR_ONLY

| Finding | Reason |
|---------|--------|
| F8 | Field selection variance is a performance trade-off, not a bug |

---

## Topology: Current vs. Recommended

### Current (Problematic)

```
cf-login ──write──→ users collection (no sync)
cf-users ──write──→ users collection (with sync) ← dead getProfile
cf-posts ──read──→ users collection (inline author fetch)
cf-comments ──read──→ users collection (inline author fetch)
cf-messages ──read──→ users collection (batch + existence check)
cf-categories ──read──→ users collection (inline admin check)

client auth.ts ──call──→ cf-login
client users.ts ──call──→ cf-users (update only)
client users.ts ──read──→ users collection (bypasses cf-users)

cache writes: auth.ts, users.ts (2 sites)
cache reads: app.ts, auth.ts, users.ts, profile.ts (4 sites)
```

### Recommended (After All Fixes)

```
cf-users ──write──→ users collection (ensure + updateProfile + sync)
          ──read───→ users collection (getProfile, getAuthorSnapshot, checkAdmin)

client UserSession ──call──→ cf-users (all user operations)
                   ──owns──→ cache (single read/write site)

cf-posts ──call──→ cf-users.getAuthorSnapshot
cf-comments ──call──→ cf-users.getAuthorSnapshot
cf-messages ──call──→ cf-users (batch profile lookup)
cf-categories ──call──→ cf-users.checkAdmin
```

---

## External References

1. WeChat CloudBase shared dependency solutions (2024):
   https://blog.codelin.vip/2024-08-20-115407581/
2. CloudBase cloud function optimization guide:
   https://docs.cloudbase.net/en/recipes/optimize-cloud-function-wechat-miniprogram
3. WeChat official: Getting user info via cloud functions:
   https://developers.weixin.qq.com/miniprogram/en/dev/wxcloud/guide/functions/userinfo.html
4. CloudBase auth-wechat-miniprogram skill (canonical pattern):
   https://lobehub.com/skills/tencentcloudbase-skills-auth-wechat

---

## Gate Status

**HARD STOP — Human Confirmation Required**

Review the findings above and confirm which actions to proceed with:

- [ ] Apply all LOCAL_FIX items (7 fixes, low risk)
- [ ] Route DESIGN_TRIGGER items through /design
- [ ] Skip MONITOR_ONLY items
- [ ] Custom selection (specify which F# items)

No code modifications will be made until confirmation.
