# Research Report: User System Consolidation

> Phase 1 of design-pipeline. Problem domain: consolidate scattered user logic
> into coherent modules across cloud functions (Node.js) and miniprogram
> services (TypeScript). CloudBase BaaS, WeChat OPENID identity.

## External References

### Ref 1: Cloud Function Shared Code — Git Submodule Pattern
- Source: https://blog.codelin.vip/2024-08-20-115407581/
- Pattern: Create a separate git repo for shared cloud function utils, add as
  git submodule into each `cloudfunctions/*/common/`. IDE bundles submodule
  contents during deployment. Updates via `git submodule foreach git pull`.
- Key trade-off: Adds git complexity (team must remember submodule commands)
  but gives proper versioned, DRY shared code.
- Relevance: Directly addresses F3/F10 (duplicated utils + author lookup).

### Ref 2: CloudBase Cloud Function Optimization
- Source: https://docs.cloudbase.net/en/recipes/optimize-cloud-function-wechat-miniprogram
- Key pattern: Put `require()` and SDK init at module scope (Node.js caches
  modules across warm invocations). Trim dependencies aggressively. Separate
  request-state from module-scope state for concurrency safety.
- Relevance: Informs the `withAuth` wrapper design (must not hold per-request
  state at module scope). The shared utils module is a prime candidate for
  module-scope init.

### Ref 3: WeChat Storage API + Cache Pattern
- Source: https://developers.weixin.qq.com/miniprogram/en/dev/framework/ability/storage.html
- Key facts: 10MB limit per user. Data persists across app exits. Isolation
  by user. Sync APIs preferred for critical session data.
- Industry pattern: Wrap cached data with `{time, data}` for expiration
  checks. Single module owns each storage key. Use try/catch for sync APIs.
- Relevance: Directly addresses F6 (scattered profile cache management).
  The `UserSession` module should be the sole owner of the `user_profile` key.

### Ref 4: Single-Responsibility Cloud Functions
- Source: General CloudBase community practice. One cloud function per
  collection's write path. Avoids divergent behavior on the same data.
- Pattern: cf-users handles all `users` collection operations (ensure,
  updateProfile, getProfile). cf-login becomes a thin redirect or is
  deprecated entirely.
- Relevance: Directly addresses F5 (login + users overlap).

## Comparison Matrix

| Dimension | Current | Proposed | Ref |
|-----------|---------|----------|-----|
| Shared code | 6 copies of utils.js | One canonical copy + deploy script | Ref 1 |
| Auth wrapper | 6x inline openid check | `withAuth(handler)` in common | Ref 2 |
| Author lookup | 3x inline pattern | `getAuthorSnapshot(db, openid)` | Ref 2 |
| User collection owner | login + users both write | Single cf-users | Ref 4 |
| Profile cache | 4 modules read/write | Single UserSession module | Ref 3 |

## Trade-off Analysis

**Git submodule vs. deploy-script copy**: Git submodule gives proper versioning
but requires team discipline and adds onboarding friction. A deploy script that
copies `cloudfunctions/common/` into each function directory is simpler and
achieves the same DRY result. The project already has `scripts/deploy-functions.sh`
— extending it to copy shared code is the path of least resistance.

**Decision**: Deploy-script copy approach. Keep `cloudfunctions/common/` as the
canonical source. `scripts/deploy-functions.sh` copies `common/` into each
function before upload. This avoids git submodule complexity while achieving
single source of truth.
