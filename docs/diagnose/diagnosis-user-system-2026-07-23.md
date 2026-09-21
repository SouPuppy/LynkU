# Diagnosis Report: User Identity System — Deep Analysis

**Date**: 2026-07-23
**Scope**: User creation, identity display, anonymous mode, messaging prerequisites
**Severity**: CRITICAL — the tap-to-chat feature we just built is broken without these fixes.

---

## Root Cause: "收信人不存在"

### The Bug

`cloudfunctions/messages/index.js:31-33`:

```javascript
try { const rec = await db.collection('users').doc(to).get()
    if (!rec.data) return fail('收信人不存在', 'USER_NOT_FOUND')
} catch (e) { return fail('收信人不存在', 'USER_NOT_FOUND') }
```

The `sendMessage` function requires the recipient to have a document in the `users` collection. If it doesn't exist, the message is rejected.

### Why User Documents Don't Exist

A user document is created in exactly ONE way: calling `ensureLogin()` from the login page → `auth.ts` → `callCloud('users', { action: 'ensure' })` → `users` CF creates the doc.

**The gap**: many users interact with the app without ever going through explicit login:

| Scenario | User doc exists? |
|----------|-----------------|
| User taps "微信一键登录" on login page | Yes |
| User browses without login (if guard is bypassed) | No |
| User only posts (author snapshot has fallback "用户") | Maybe not |
| User only comments | Maybe not |
| User is seen in someone else's post as author | Depends |

**But the `requireLogin()` guard on every page means users MUST log in to enter the app.** So in theory, every active user has a user document.

However, there are edge cases:
1. **Race condition**: User A opens app → login → posts. User B taps A's name to chat. Between A's login and B's chat, A's CloudBase login might not have synced.
2. **CloudBase login vs user doc**: The `onLaunch` does `wx.cloud.init()` which gives an `OPENID`. But the `users` collection document is separate. `OPENID` is always available; user doc is not.
3. **The actual failure**: `sendMessage` in the cloud function does `db.collection('users').doc(to).get()`. If the recipient's openid doesn't match any document, it fails. But WeChat's OPENID is guaranteed to be valid — the person exists. The failure is an artifact of our user doc design.

### The Real Problem

The `users` collection serves two conflicting purposes:
1. **Login cache**: stores profile data (nickname, avatar) for users who explicitly logged in
2. **Recipient validation**: used to check if a message recipient "exists"

Purpose #2 is wrong. Every WeChat user with an OPENID "exists." The `users` collection should not be a gatekeeper for messaging.

---

## Gap Analysis: Full User System

### G-1: No auto-user-creation

**Location**: `app.ts`, `services/auth.ts`, cloud functions

The app initializes CloudBase in `onLaunch` and gets `OPENID`, but never calls `ensureLogin()` automatically. The login page is the only path to user creation. If the login page is skipped (e.g., deep link, re-entry with session cache), some paths might not create the user doc.

**Compare with industry standard**: Every major social app (WeChat itself, Twitter, Reddit) auto-creates a user record on first app open. The login step is for profile setup, not for existence.

### G-2: sendMessage requires user doc — should not

**Location**: `cloudfunctions/messages/index.js:31-33`

The `sendMessage` function gatekeeps on user doc existence. This is the wrong check. The correct check should be:
- Does the recipient OPENID exist in the WeChat ecosystem? (always yes — it comes from `wx.cloud.getWXContext()`)
- Is the recipient a valid user of THIS app? (not necessarily in `users` collection)

The fix: allow sending messages to any valid OPENID. If the recipient doesn't have a user doc, create a minimal one on-the-fly, or store messages by OPENID only.

### G-3: Anonymous mode is client-side theater

**Location**: `services/anonymous.ts`, `cloudfunctions/posts/index.js:48-49`

The entire anonymous system relies on:
1. `wx.getStorageSync('anonymous_mode')` in the client — trivially manipulated
2. Client passes `anonymous: true/false` to cloud functions
3. Cloud functions trust the client flag

**What actually happens**:
- When `anonymous: true`, the post/comment uses `{ nickname: '匿名用户', avatar_url: '' }` as author
- But `_openid` is ALWAYS stored in the document
- The original `_openid` is visible to anyone with database access
- Admins can de-anonymize any post by looking at the `_openid` field

**This is misleading to users**: They toggle "匿名模式" thinking they're anonymous, but their identity is fully tracked. This is a trust violation.

**Industry standard**: True anonymity requires the server to NOT store identifiable data. Since WeChat always provides OPENID, true anonymity is impossible without a proxy/mix network. The honest approach is to tell users "匿名对其他用户隐藏你的信息，但平台保留记录" (anonymous hides your info from other users, but the platform retains records).

### G-4: Identity display is useless

**Location**: All author display locations (`post-item`, `comment-item`, `post.wxml`)

The author display shows:
- `nickname`: "微信用户" (default), whatever the user set, or "用户" (fallback)
- `avatar_url`: WeChat avatar or empty
- No indicator of account status

Multiple users can have identical display names. There's no way to distinguish User A from User B. The `_openid` is the only unique identifier, but it's never shown to users.

**Industry standard**: At minimum, show `@username` alongside display name. At best, show a unique handle, join date, post count.

### G-5: No user profile pages

**Location**: Nonexistent

There is no `/pages/user/user?id=<openid>` page. Tapping a user's name can only:
1. Do nothing (before UNI-002)
2. Open chat (after UNI-002)

You can't see someone's posts, join date, or any public info. The `users` collection has `role` but no `bio`, `join_date`, or `post_count`.

### G-6: Denormalized author data is stale

**Location**: `cloudfunctions/users/index.js:97-105` (`syncAuthorData`)

When a user updates their nickname/avatar, `syncAuthorData` updates the `posts` and `comments` collections. But NOT:
- `messages` (conversation list shows old names)
- `notifications` (notifications show old actor names)

This means if a user changes their name, old conversations and notifications keep the old name.

---

## How Our UNI-002 (Tap-to-Chat) Makes This Worse

We just shipped tap-to-chat across 5 components. Here's the flow:

1. User A sees User B's post
2. User A taps B's avatar → chat page opens
3. User A types message → sends
4. `sendMessage` CF checks `users.doc(B._openid).get()` → **FAILS** (if B never explicitly logged in, even though B posted!)
5. User A sees "收信人不存在" toast

This is a broken UX that we just shipped. The tap-to-chat feature is **non-functional** for users who haven't explicitly logged in — even if they have posted content.

---

## Calibration

| Finding | External Reference | Verdict |
|---------|-------------------|---------|
| G-1: No auto-user-creation | WeChat CloudBase best practices: create user doc on first `wx.cloud.init()` | CONFIRMED |
| G-2: sendMessage user doc gate | Standard messaging: validate recipient by existence in ecosystem, not in app-specific cache | CONFIRMED |
| G-3: Anonymous mode is theater | GDPR/Privacy: "anonymous" that isn't is a trust violation | CONFIRMED |
| G-4: No unique identity display | Every social platform has unique handles | CONFIRMED |
| G-5: No profile pages | Basic social feature, expected by users | CONFIRMED |
| G-6: Stale denormalized data | Standard: either sync all collections or use references | CONFIRMED |

---

## Classification

| ID | Severity | Action | Status |
|----|----------|--------|--------|
| G-1 | CRITICAL | LOCAL_FIX | **FIXED** — app.ts now calls ensureLogin() on launch |
| G-2 | CRITICAL | LOCAL_FIX | **FIXED** — sendMessage no longer gates on user doc existence |
| G-3 | WARNING | LOCAL_FIX | **FIXED** — anonymous toggle shows disclosure text |
| G-4 | WARNING | DESIGN_TRIGGER | **DEFERRED** — needs unique handles + identity design |
| G-5 | WARNING | DESIGN_TRIGGER | **DEFERRED** — needs user profile page design |
| G-6 | WARNING | LOCAL_FIX | **FIXED** — syncAuthorData now covers notifications |

---

## Fix Summary (2026-07-23)

### G-1: Auto-bootstrap user on launch
`miniprogram/app.ts:28-33` — `ensureLogin()` is called fire-and-forget in `onLaunch`. Creates user doc before any interaction. Idempotent — safe to call on every launch.

### G-2: Remove user doc gate from sendMessage
`cloudfunctions/messages/index.js:31-34` — Removed the `users.doc(to).get()` check. Every WeChat user with an OPENID can receive messages. `listConversations` already has a peer profile fallback (`{ nickname: '用户', avatar_url: '' }`).

### G-3: Anonymous mode disclosure
`miniprogram/pages/profile/profile.wxml` — Added text below anonymous toggle: "开启后对其他用户隐藏你的身份信息，平台保留管理记录"

### G-6: syncAuthorData covers notifications
`cloudfunctions/users/index.js:97-115` — Added `notifications` collection to author sync. Actor data in notifications now updates when user changes nickname/avatar. Messages don't need sync (peer profiles fetched live).

### Deferred (need /design pass)
- **G-4**: Unique user identity (handles, join date visible)
- **G-5**: User profile page (`/pages/user/user?id=<openid>`)
