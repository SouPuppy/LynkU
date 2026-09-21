# PR/FAQ: User Profile Page (G-4 + G-5)

## Problem

Currently, the app has no user identity layer:

1. **Tapping an avatar/name jumps straight to chat.** There's no way to learn about someone before messaging them — no profile, no post history, no context.
2. **All users look the same.** Without auto-bootstrap (G-1, now fixed), unregistered users showed "用户". Even with nicknames, there's no way to distinguish two users with the same WeChat name.
3. **No user discovery.** You can't browse someone's activity to decide if you want to engage.

These are the last two gaps from the user system diagnosis (G-4, G-5).

## Solution

### User Profile Page (`/pages/user/user`)

A new page accessible from anywhere an avatar or username appears. Replaces the current tap-to-chat shortcut with a profile-first flow.

```
+----------------------------------+
|  < 用户资料                       |  ← nav-bar with back
+----------------------------------+
|                                  |
|         [large avatar]           |
|         Nickname                 |
|         @wxid_abc123             |  ← truncated openid as unique handle
|         2024-09-01 加入           |  ← join date
|         15 篇帖子                 |  ← post count
|                                  |
|  [发私信]                         |  ← CTA button (hidden if self)
+----------------------------------+
|  最近帖子                          |
|  +----------------------------+  |
|  | post-item                  |  |
|  | post-item                  |  |
|  | ...                        |  |
|  +----------------------------+  |
+----------------------------------+
```

### Tap Flow Change

```
Before (UNI-002):   Tap avatar → chat page
After:              Tap avatar → profile page → [发私信] → chat page
```

One extra tap, but standard social-app pattern. Users get context before engaging.

### Unique Identity

Use `_openid` truncated as a visible handle: `@wxid_abc123...`. This is:
- Automatically unique (CloudBase guarantees unique openids)
- No registration needed
- Not PII (openid is app-specific, not the WeChat global ID)

Display as: `@` + first 10 chars of openid (e.g., `@oVZ4s5KxYz`).

### Data Sources

| Display | Source | Already Implemented? |
|---------|--------|---------------------|
| Avatar, nickname | `users.doc(openid).get()` | Yes — `services/users.ts:getProfile` |
| Join date | `users` doc `created_at` | Yes — field exists |
| Post count | `posts.where({ _openid }).count()` | No — need to add |
| Recent posts | `posts.where({ _openid, status: 'published' })` | Yes — `services/posts.ts:listPosts` |

## Architecture Impact

```
New:
  pages/user/user.*           ← profile page
  pages/user/user.json        ← registers post-item, nav-bar, avatar components

Modified:
  post-item.ts                ← onAuthorTap → profile (was: → chat)
  comment-item.ts             ← onAuthorTap → profile (was: → chat)
  post.ts                     ← onAuthorTap → profile (was: → chat)
  notification-card.ts        ← onActorTap → profile (was: → chat)
  services/users.ts           ← add getPostCount
```

## Customer Quote

> "Before, I'd tap someone's name and suddenly I'm in a chat. Who IS this person? Now I can see their profile, their posts, and THEN decide to message them."

## Scope

| In Scope | Out of Scope |
|----------|-------------|
| Profile page with avatar, nickname, handle, join date, post count | Edit profile (already in settings) |
| Recent published posts list | User's comments list |
| "发私信" button → chat | Follow/block user |
| Tap avatar/name → profile (4 locations) | User search / user directory |
| Unique handle derived from openid | Custom @username |

## FAQ

**Q: Why openid-truncated as handle and not a custom username?**
A: Zero registration friction. Every user automatically has a unique handle. Custom usernames require: uniqueness check, profanity filter, settings UI, migration. Ponytail: add custom handles when users ask for them.

**Q: Does this break the tap-to-chat we just built?**
A: It changes the flow by one tap. The old `onAuthorTap → chat` becomes `onAuthorTap → profile → button → chat`. The chat page code is untouched.

**Q: What about tapping your own avatar?**
A: Shows your own profile with no "发私信" button. You can see your own posts and stats.

**Q: What if the user document doesn't exist?**
A: After G-1 fix, every user has a doc. Fallback: show default avatar + "微信用户" + openid handle. The `getProfile` function already returns null for missing docs — page handles this gracefully.

**Q: How many posts to show on the profile?**
A: 20 most recent published posts, paginated (same PAGE_SIZE as feed). ponytail: add load-more when profile posts exceed 20.
