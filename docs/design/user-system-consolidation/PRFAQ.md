# PR/FAQ: User System Consolidation

## Problem

The user system has 6 cloud functions each carrying a copy of the same utility
code. Three cloud functions independently implement author lookup. Two cloud
functions (login + users) share write ownership of the `users` collection with
divergent behavior — one syncs denormalized data, the other doesn't. On the
client, 4 modules independently read and write the profile cache with no single
owner. The result: stale author data, duplicated bug fixes, and no clear source
of truth for user state.

## Solution

Three tightly-scoped changes, zero new dependencies:

1. **Shared cloud function module** (`cloudfunctions/common/`): Extracts
   duplicated utils + author lookup + auth middleware into a single canonical
   location. A deploy script copies it into each cloud function directory
   before upload (no git submodule complexity).

2. **Merged cf-users**: login's `ensureUser` moves into cf-users. All `users`
   collection writes happen in one place, with consistent validation and
   denormalized sync. cf-login becomes a thin redirect (removed after deploy).

3. **UserSession module** (`services/session.ts`): Single owner of the
   `user_profile` storage key and `globalData.user`. All other modules read
   and write through it. One place to debug, one place to extend.

## Customer Quote

> "Before: I changed my nickname during login but my old posts still showed the
> old name. I had to go to profile settings to 'fix' it. After: one nickname
> change, everywhere updated."

## FAQ

**Q: Why not use git submodules for shared cloud function code?**
A: Git submodules add onboarding friction (team must remember `git submodule
update --init`). The project already has `scripts/deploy-functions.sh` —
extending it to copy `common/` into each function directory is simpler and
achieves the same single source of truth.

**Q: Does this change the API surface?**
A: No. The cloud function action names (`ensure`, `updateProfile`) and the
client service function signatures remain identical. The only change is that
`auth.ts` calls `users` cloud function instead of `login`.

**Q: What happens to cf-login after the merge?**
A: Phase 1: cf-login becomes a thin redirect to cf-users.ensure. Phase 2
(after next deploy): cf-login directory is deleted. The redirect ensures no
client breakage during the transition.

**Q: How many files change?**
A: ~16 files across cloud functions, services, and deploy scripts. No new
external dependencies. No database migration needed.

## Scope

**In scope**:
- Create `cloudfunctions/common/index.js` with all shared utilities
- Merge `ensureUser` from cf-login into cf-users
- Make cf-login a thin redirect
- Create `services/session.ts`
- Update all consumers (auth.ts, users.ts, app.ts, profile.ts)
- Update `scripts/deploy-functions.sh`
- Remove per-function utils.js (replaced by common)

**Out of scope**:
- Role/permission system changes
- New user fields or profile features
- Database schema migration
- Git submodule setup
