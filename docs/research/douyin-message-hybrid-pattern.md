# Douyin-Style Hybrid Message Architecture — Research Report

## Problem Domain

The current Lucky BBS messages page is a flat conversation list: each entry is a
1:1 DM thread with another user. The user wants to add a second message type --
interaction notifications (comments, likes, follows, system messages) -- that
appears as a special "Stub" entry pinned at the top of the conversation list.
Tapping the Stub opens a feed of individual notification-style messages, exactly
like Douyin's message tab.

The core question: how to model this hybrid of "notification inbox" and
"conversation list" within the existing WeChat CloudBase architecture.

## References

### Reference 1: Douyin Message Page Architecture

- Source: https://juejin.cn/post/7200953096892825659 (ByteDance Youth Training Camp —
  Chat Module lecture notes)
- Architecture pattern: **Two-tier hierarchical list**
  - First-level (一级列表): Direct message conversations between users, sorted by
    most recent message time. Also includes a special "服务消息" (Service Messages)
    and "互动消息" (Interaction Notifications) entry at the top.
  - Second-level (二级列表): When user taps an entry from first-level, they drill
    into either a 1:1 chat view (for DM conversations) or a notification feed
    (for interaction/service entries). The notification feed is a flat,
    time-ordered list of individual events.
- Interface design style: Single-page message tab, all message types accessible
  from one scrollable list. No tab switching between "notifications" and
  "messages" -- they coexist in the same list hierarchy.
- Extension strategy: New notification types (system announcements, activity
  alerts, mini-program service messages) are added as new first-level entries
  or merged into existing second-level feeds. The feed is extensible by message
  type enum.
- Key trade-offs:
  - **Pro**: Users never miss notifications because they live alongside DMs
  - **Pro**: Single entry point reduces navigation complexity
  - **Con**: The feed UI must handle heterogeneous message types (like vs
    comment vs follow) with different display templates

### Reference 2: Meta's Hybrid Messaging Inbox Patent

- Source: US Patent US20120054132A1 — "Messaging System with Multiple Display
  Areas" (Meta/Facebook)
- Architecture pattern: **Multi-section scrollable inbox**
  - Top section: Unread/recent conversation threads (collapsed "stub" form)
  - Middle section: Functional modules -- Top Contacts, Events, Businesses
  - Bottom section: Older/read conversation threads
  - A dynamic threshold controls the boundary between sections based on user
    activity, time of day, and unread state
- Interface design style: Modules are rendered inline in a single scroll view.
  Each module has its own header, expand/collapse affordance, and internal
  ranking logic. Unlike Douyin's drill-down approach, Meta renders the modules
  directly in the list (no second-level navigation).
- Extension strategy: Modules are pluggable -- new module types (Live Videos,
  Stickers, Businesses) are added by registering a module renderer and ranking
  strategy without changing the scroll container.
- Key trade-offs:
  - **Pro**: Everything visible without navigation -- higher discovery
  - **Con**: Scroll length grows unbounded with module count
  - **Con**: Module ranking logic is complex (inter-module + intra-module)

### Reference 3: Chat App Design Best Practices (CometChat)

- Source: https://www.cometchat.com/blog/chat-app-design-best-practices
- Architecture pattern: **Conversation list as primary surface**, with
  categorized sections for different conversation types
- Interface design style:
  - Search bar at the top (always visible)
  - Conversations sorted by most recent message timestamp
  - Unread badges on each conversation row
  - Quick actions (swipe to mute/delete/mark-read)
- Key insight: The conversation list is the most frequently visited screen in
  any messaging app. Its design should optimize for scanability and quick
  access. Injecting non-conversation items (notifications, system messages) at
  the top of this list is a standard pattern.

## Comparison

| Dimension | Douyin | Meta (Patent) | Lucky BBS (current) |
|-----------|--------|---------------|---------------------|
| Structure | Two-tier (list → detail) | Single scroll with modules | Flat conversation list |
| Notification placement | First-level entry → second-level feed | Inline module in scroll | N/A |
| DM conversations | First-level, time-sorted | Bottom section + top unread section | Entire list |
| Stub concept | "互动消息" entry at top of list | "Unread threads" collapsed section | N/A |
| Extensibility | Add new entries to first-level list | Register new module type | N/A |
| Data model | Separate tables: messages + notifications | Unified inbox with type discriminator | Single `messages` collection |

## Trade-off Analysis

### Douyin Two-Tier vs. Meta Inline Modules

The user's description ("Stub 用户相当于最上面的一个用户 点进去是每一条私信") maps
directly to Douyin's two-tier model. The trade-off:

**Douyin two-tier** (recommended for Lucky BBS):
- Simpler to implement -- the Stub is just a synthetic conversation entry
- The notification feed is a separate page, reusing chat-bubble components with
  a different data source
- Lower cognitive load on the conversation list screen
- Fits the existing codebase: `messages` page already has a conversation list;
  adding one synthetic entry and a new feed page is a small diff

**Meta inline modules**:
- Everything visible without navigation
- Requires a more complex scroll container that mixes conversation rows with
  notification cards
- Harder to implement incremental loading (two different pagination strategies
  in one scroll view)

### Synthetic User vs. Separate Concept

Modeling the Stub as a "user" has pros and cons:

- **Pro**: Reuses the existing `IConversation` model -- the stub is just a
  conversation with `peer._openid = '__system__'` or similar sentinel value
- **Pro**: The conversation list code doesn't need to know about the stub; it
  just renders another row
- **Con**: Leaks implementation detail -- `__system__` is not a real user
- **Con**: The chat page would need a special case to render the notification
  feed instead of a 1:1 chat

Better approach: model the Stub as a **first-class concept** in the UI layer but
keep it separate from the `IConversation` data model. The messages page inserts
the Stub row at position 0 of the rendered list, but it's not in the
`conversations` array from the API.

## Recommendations

1. **Adopt Douyin's two-tier model**. The Stub sits at the top of the
   conversation list as a UI-level construct (not a real conversation). Tapping
   it navigates to a new `pages/notifications/notifications` page that renders a
   feed of interaction events.

2. **Data model**: Add a `notifications` collection (or extend the existing
   `messages` collection with a `type` discriminator). Each notification has:
   - `type`: 'comment' | 'reply' | 'like' | 'follow' | 'system'
   - `actor`: user who performed the action
   - `target`: post/comment that was acted on (for deeplinking)
   - `created_at`: timestamp
   - `read`: boolean

3. **Backend**: Add a `listNotifications` cloud function action. The Stub row
   shows the count of unread notifications and a preview of the most recent one.

4. **Frontend**: The messages page renders a hardcoded Stub row at index 0 with
   unread badge, followed by the conversation list. The row uses the same visual
   pattern as conversation rows (avatar + title + preview + time + badge) for
   consistency.

5. **Feed page**: `pages/notifications/notifications` is a scrollable feed of
   notification cards. Each card type has a distinct template:
   - "X 赞了你的帖子" with post title link
   - "X 评论了你的帖子" with comment preview
   - "X 关注了你"
   - System announcement with rich text

6. **Tab bar badge**: The "私信" tab bar icon should show the aggregate unread
   count (Stub unread + conversation unread).
