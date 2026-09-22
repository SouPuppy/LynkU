# PR/FAQ: Unified Messages + Tap-to-Chat + Comment Notification Completion

## Problem

Currently, the LynkU messaging/notification system has three structural gaps:

1. **No way to start a private chat.** A user browsing the forum sees other users' posts and comments, but can't initiate a conversation. The only way to chat is if someone messages you first. This breaks the core social loop: discover → connect → chat.

2. **Notifications are siloed on a separate page** (`/pages/notifications/notifications`). The Messages tab shows a "消息通知" stub row that links away. Users expect comment replies to appear alongside their conversations — both are "messages from people."

3. **Reply notifications are broken.** The comments cloud function only emits notifications for top-level comments (depth=0). If someone replies to your comment (depth=1), you never know. Also, there's no `reply` type notification emitted anywhere despite the type being defined in `NotificationType`.

## Solution

Three interconnected changes, all within existing modules:

### 1. Unified Messages Tab (Tabbed UI)

The Messages page (`pages/messages/messages`) becomes a two-tab view:

```
+----------------------------------+
|  [私信]  [系统消息 (3)]          |  ← tab bar
+----------------------------------+
|  (tab content switches here)     |
|                                  |
|  Tab 1 = conversation list       |
|  Tab 2 = notification feed       |
+----------------------------------+
```

- **Tab "私信"**: The existing conversation list (unchanged)
- **Tab "系统消息"**: Inline notification feed using `notification-card` component, with cursor-based pagination and swipe-to-refresh

The separate `/pages/notifications/notifications` page is kept temporarily (backward compat) but no longer linked from Messages tab. The notification stub row is removed — replaced by the tab.

### 2. Tap-to-Chat (Avatar/Username Tap Handlers)

Anywhere a user's avatar or name appears next to another user's content, tapping it opens a chat:

| Location | Component | Trigger |
|----------|-----------|---------|
| Feed list post card | `post-item` | Tap author avatar or name |
| Post detail page | `pages/post/post.wxml` | Tap author avatar or name |
| Comment (top-level) | `comment-item` | Tap author avatar or name |
| Comment reply | `comment-item` | Tap reply author avatar or name |
| Notification card | `notification-card` | Tap actor avatar or name |

**Constraints:**
- Tapping yourself does nothing (no self-chat)
- Tapping an anonymous user does nothing (no identity to chat with)
- Navigation: `wx.navigateTo({ url: '/subpkg-chat/pages/chat/chat?peer=<openid>&name=<nickname>&avatar=<avatar_url>' })`

### 3. Complete Comment Notification System

Fix the comments cloud function to emit notifications for ALL comment interactions:

| Action | Notification To | Type | Condition |
|--------|----------------|------|-----------|
| Top-level comment on your post | Post author | `comment` | Commenter != post author |
| Reply to your comment | Parent comment author | `reply` | Replier != parent author |
| Reply to a comment on your post | Post author | `comment` | Replier != post author AND replier != parent (avoid double-notify) |

Also emit `reply` type for the reply case. The `NotificationType` already has `'reply'` defined — it just was never emitted.

**Idempotency**: Keep the existing 5-minute duplicate check. One notification per (type, actor, target) tuple per 5-minute window.

## Architecture Impact

```
Before:                          After:

Messages tab ──→ conversations   Messages tab ──→ [Tab 1] conversations
    │                                              [Tab 2] notifications (inline)
    └──→ stub → /notifications

post-item: no tap               post-item: tap → /chat
comment-item: no tap            comment-item: tap → /chat
post page: no tap               post page: tap → /chat
notification-card: → /post      notification-card: → /post OR /chat

comments CF:                     comments CF:
  depth=0 → 'comment' notif       depth=0 → 'comment' notif (+ post author check)
  depth=1 → nothing               depth=1 → 'reply' notif to parent author
                                  depth=1 → 'comment' notif to post author (if different)
```

Zero new modules. Zero new cloud functions. Zero new dependencies. All changes extend existing surfaces.

## Customer Quote

> "I saw someone post about a course I'm taking. I wanted to ask them a question privately, but there was no way to message them. I had to post a public comment asking them to DM me. Lame."

## Scope

| In Scope | Out of Scope |
|----------|-------------|
| Tabbed Messages UI (私信 + 系统消息) | Push notifications (service-level) |
| Tap-to-chat on avatars/usernames (4 components + post page) | User profile page |
| Reply notifications in comments CF | Like/follow notifications |
| Unified unread badge on tab bar | Real-time notification push |
| Remove notification stub from messages page | Deleting old notifications page |

## FAQ

**Q: Why tabs and not a merged single list?**
A: Different content types. Conversations show `[avatar] [name] [last message]`. Notifications show `[actor] [action text] [target preview]`. Merging them into one list forces a lowest-common-denominator card that serves neither well.

**Q: Why keep the old notifications page?**
A: Backward compatibility. Any existing deep links or habits don't break. Remove in a follow-up cleanup pass. Ponytail: don't delete until confirmed unused.

**Q: How does the chat page know the other user's name?**
A: Passed via URL params: `peer=<openid>&name=<nickname>`. The chat page already reads these. The post/comment author object has `_openid`, `nickname`, `avatar_url` — all three are passed.

**Q: What if I tap an anonymous user?**
A: Anonymous users have `_openid` in the data but display "匿名用户". Tapping them does nothing. The `anonymous` flag is checked before navigation.

**Q: What about self-tap?**
A: The tap handler compares `author._openid` against `getOpenid()`. If same user, no navigation.

**Q: Will this break existing conversation list?**
A: No. The conversation list (Tab 1) is untouched. Only the notification stub row is replaced by tabs.

**Q: What's the tab bar badge behavior?**
A: The tab bar badge shows total unread = conversations unread + notifications unread. Updated when either tab loads new data.
