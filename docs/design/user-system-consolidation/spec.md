# Module Specifications: User System Consolidation

> Phase 3 of design-pipeline. Interface contracts for new/changed modules.

## N1: cloudfunctions/common/index.js

### Interface: `ok(data)`
- **Signature**: `ok(data: object) => { data: object }`
- **Preconditions**: None
- **Postconditions**: Returns `{ data }` envelope
- **Side effects**: None
- **Failure modes**: None (pure function)

### Interface: `fail(error, code?)`
- **Signature**: `fail(error: string, code?: string) => { error: string, code: string }`
- **Preconditions**: None
- **Postconditions**: Returns `{ error, code }` where code defaults to `'UNKNOWN'`
- **Side effects**: None
- **Failure modes**: None (pure function)

### Interface: `validateInput(value, rules?)`
- **Signature**: `validateInput(value: any, rules?: { minLen?: number, maxLen?: number }) => { valid: boolean, error?: string }`
- **Preconditions**: None
- **Postconditions**: If valid, `{ valid: true }`. If invalid, `{ valid: false, error: string }`
- **Side effects**: None
- **Failure modes**:
  - FM1: Empty/undefined value → `{ valid: false, error: '输入不能为空' }`
  - FM2: Below minLen → `{ valid: false, error: '最少需要 N 个字符' }`
  - FM3: Above maxLen → `{ valid: false, error: '最多允许 N 个字符' }`

### Interface: `filterSensitiveWords(text)`
- **Signature**: `filterSensitiveWords(text: string) => { clean: boolean, matches: string[] }`
- **Preconditions**: `text` is a string
- **Postconditions**: Returns whether text is clean and which words matched
- **Side effects**: None
- **Failure modes**: None (graceful on non-string input — returns clean)

### Interface: `checkAdmin(db, openid)`
- **Signature**: `checkAdmin(db: Database, openid: string) => Promise<boolean>`
- **Preconditions**: `db` is an initialized CloudBase database instance
- **Postconditions**: Returns `true` if user exists and has role `'admin'`, `false` otherwise
- **Side effects**: Reads `users` collection
- **Failure modes**:
  - FM1: User not found → `false`
  - FM2: DB read error → `false` (fail-safe: deny on error)

### Interface: `getAuthorSnapshot(db, openid)`
- **Signature**: `getAuthorSnapshot(db: Database, openid: string) => Promise<{_openid: string, nickname: string, avatar_url: string}>`
- **Preconditions**: `db` is initialized, `openid` is a valid string
- **Postconditions**: Always returns an author object. Falls back to defaults on error.
- **Side effects**: Reads `users` collection
- **Failure modes**:
  - FM1: User not found → `{ _openid: openid, nickname: '用户', avatar_url: '' }`
  - FM2: DB read error → same fallback (never throws)

### Interface: `withAuth(handler)`
- **Signature**: `withAuth(handler: (openid: string, event: object, context: object) => Promise<object>) => (event: object, context: object) => Promise<object>`
- **Preconditions**: Called within a cloud function entry point. `cloud.init()` must have been called.
- **Postconditions**: Extracts `OPENID` from `cloud.getWXContext()`. Returns `fail('身份验证失败', 'AUTH_FAILED')` if no openid. Otherwise calls `handler(openid, event, context)`.
- **Side effects**: None
- **Failure modes**:
  - FM1: No OPENID in context → returns fail envelope directly

---

## N2: cloudfunctions/users/index.js (merged)

### Interface: `exports.main(event, context)`
- **Signature**: `main(event: {action: string, ...}, context: object) => Promise<CloudResult>`
- **Preconditions**: Caller is authenticated via WeChat runtime (OPENID in context)
- **Postconditions**: Dispatches to action handler. Returns ok or fail envelope.
- **Side effects**: Reads/writes `users`, `posts`, `comments` collections
- **Actions**:
  - `ensure`: Create-or-update user document. Syncs denormalized author data on update.
  - `updateProfile`: Update nickname/avatar with validation. Syncs denormalized author data.
- **Failure modes**:
  - FM1: Unknown action → `fail('未知操作', 'UNKNOWN_ACTION')`
  - FM2: Invalid input → `fail(validation_error, 'INVALID_INPUT')`
  - FM3: DB write failure → `fail('更新失败', 'UPDATE_ERROR')`

---

## N8: miniprogram/services/session.ts (new)

### Interface: `get(): IUserPublic | null`
- **Signature**: `get() => IUserPublic | null`
- **Preconditions**: App initialized
- **Postconditions**: Returns current user profile or null. Checks globalData first (in-memory, most recent), falls back to storage.
- **Side effects**: Reads `globalData.user`, reads `wx.getStorageSync('user_profile')`
- **Failure modes**:
  - FM1: Storage read error → returns null (caught internally)

### Interface: `set(profile: IUserPublic): void`
- **Signature**: `set(profile: IUserPublic) => void`
- **Preconditions**: `profile` is a valid IUserPublic object
- **Postconditions**: `globalData.user` and `storage('user_profile')` are both updated
- **Side effects**: Writes to globalData, writes to storage
- **Failure modes**:
  - FM1: Storage write error → logged, not thrown (best-effort cache)

### Interface: `clear(): void`
- **Signature**: `clear() => void`
- **Preconditions**: None
- **Postconditions**: `globalData.user` set to null, `storage('user_profile')` removed
- **Side effects**: Clears globalData, removes storage key
- **Failure modes**:
  - FM1: Storage remove error → logged, not thrown
