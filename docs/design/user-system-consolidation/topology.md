# Topology Model: User System Consolidation

> Phase 2 of design-pipeline. Module graph: nodes, edges, boundaries.
> YAGNI gate applied per ponytail rules.

## Current Topology (Pre-Consolidation)

```
┌── Cloud Functions ─────────────────────────────────────┐
│                                                         │
│  cf-login ──write──→ users collection                   │
│  cf-users ──write──→ users collection (sync to posts/comments) │
│  cf-posts ──read──→ users collection (inline author fetch) │
│  cf-comments ──read──→ users collection (inline author fetch) │
│  cf-messages ──read──→ users collection (batch + check) │
│  cf-categories ──read──→ users collection (admin check) │
│                                                         │
│  Each has own copy of utils.js                          │
│  Each repeats: getWXContext() + auth check               │
└─────────────────────────────────────────────────────────┘

┌── Client Services ─────────────────────────────────────┐
│                                                         │
│  auth.ts ──call──→ cf-login                             │
│  auth.ts ──write──→ storage('user_profile')             │
│  auth.ts ──write──→ globalData.user                     │
│                                                         │
│  users.ts ──call──→ cf-users (update only)              │
│  users.ts ──read──→ users collection (bypasses cf)      │
│  users.ts ──write──→ storage('user_profile')            │
│  users.ts ──write──→ globalData.user                    │
│                                                         │
│  app.ts ──read───→ storage('user_profile')              │
│  app.ts ──write──→ globalData.user                      │
│                                                         │
│  profile.ts ──read──→ storage('user_profile')           │
│  profile.ts ──read──→ globalData.user                   │
└─────────────────────────────────────────────────────────┘
```

## Proposed Topology (Post-Consolidation)

### Node Catalog

| ID | Name | Category | Responsibility |
|----|------|----------|----------------|
| N1 | `cloudfunctions/common/` | Utility | Shared helpers: ok/fail/validate/filter/checkAdmin/getAuthorSnapshot/withAuth |
| N2 | `cloudfunctions/users/` | Service | Single owner of `users` collection: ensure, updateProfile |
| N3 | `cloudfunctions/posts/` | Service | Post CRUD. Uses N1 for auth + author lookup |
| N4 | `cloudfunctions/comments/` | Service | Comment CRUD. Uses N1 for auth + author lookup |
| N5 | `cloudfunctions/messages/` | Service | Private messaging. Uses N1 for auth + author lookup |
| N6 | `cloudfunctions/categories/` | Service | Category admin. Uses N1 for auth + admin check |
| N7 | `cloudfunctions/login/` | Adapter (deprecated) | Redirect to cf-users.ensure. Marked for removal after deploy. |
| N8 | `services/session.ts` | Service | Single owner of profile cache (storage + globalData) |
| N9 | `services/auth.ts` | Adapter | Login flow. Delegates to N2 (cf-users), reads cache via N8 |
| N10 | `services/users.ts` | Service | Profile read/write. Delegates to N2 (cf-users), reads cache via N8 |
| N11 | `app.ts` | Entry Point | App init. Restores cache via N8 only |
| N12 | `pages/profile/` | UI | Profile display. Reads user state via N8 only |
| N13 | `scripts/deploy-functions.sh` | Tooling | Copies N1 into each cloud function dir before upload |

### Edges

```
N1 (common) ← N2, N3, N4, N5, N6  [imports] — shared utils
N2 (cf-users) → users collection   [owns writes]
N2 (cf-users) ← N1                 [imports]
N3 (cf-posts) ← N1                 [imports getAuthorSnapshot, withAuth]
N4 (cf-comments) ← N1              [imports getAuthorSnapshot, withAuth]
N5 (cf-messages) ← N1              [imports getAuthorSnapshot, withAuth]
N6 (cf-categories) ← N1            [imports checkAdmin, withAuth]
N7 (cf-login) → N2                 [redirects to cf-users.ensure]

N8 (session) → storage('user_profile')  [owns cache key]
N8 (session) → globalData.user           [owns global state]
N9 (auth) → N2 (cf-users)               [calls ensure]
N9 (auth) ← N8 (session)                [reads/writes cache]
N10 (users) → N2 (cf-users)             [calls updateProfile]
N10 (users) ← N8 (session)             [reads/writes cache]
N11 (app) ← N8 (session)               [restores cache]
N12 (profile) ← N8 (session)           [reads user state]

N13 (deploy script) → N1               [copies common/ into each cf dir]
```

### Boundary Conditions

1. **Identity boundary**: `cloud.getWXContext().OPENID` — WeChat runtime guarantee.
   Handled by `withAuth()` wrapper in N1.
2. **Storage boundary**: `wx.setStorageSync`/`wx.getStorageSync` — 10MB/user limit.
   Handled by N8 (session).
3. **Database boundary**: CloudBase `users` collection. Writes via N2 only.
4. **Network boundary**: `wx.cloud.callFunction()` — handled by `callCloud()` in
   `services/cloud.ts` (unchanged).

### Deleted Nodes

- `cloudfunctions/login/utils.js` — replaced by N1
- `cloudfunctions/users/utils.js` — replaced by N1
- `cloudfunctions/comments/utils.js` — replaced by N1
- `cloudfunctions/messages/utils.js` — replaced by N1
- `cloudfunctions/categories/utils.js` — replaced by N1
- Direct storage writes in `auth.ts` and `users.ts` — moved to N8
- `cloudfunctions/login/index.js` — deprecated (N7), removed after deploy
- `cloudfunctions/users/getProfile` action — already removed in LOCAL_FIX

### YAGNI Gate

- `withAuth()` wrapper: YES — used by 5 cloud functions, eliminates 10 lines each
- `getAuthorSnapshot()`: YES — used by 3 cloud functions, eliminates copy-paste
- `session.ts`: YES — 4 modules currently manage cache, consolidation is warranted
- `IUserPublic` Omit type: already done in LOCAL_FIX
- No new external dependencies introduced
