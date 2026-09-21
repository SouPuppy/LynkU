# PR/FAQ: Profile Page Redesign + Account Settings

> Date: 2026-07-22
> Depth: Shallow — UI redesign of existing page, add edit-profile modal

## Problem

The current profile page is functional but unattractive:
- User card is flat white with just avatar + name + role text
- "Account Settings" tab has one dummy button ("编辑资料" shows a "开发中" toast)
- Two-tab layout (posts / settings) fragments a short page
- No stats, no visual hierarchy, no polish

## Solution

**Single-page layout** — merge tabs into one scrollable page:

```
┌─────────────────────────┐
│      User Card           │
│   [avatar]               │
│   用户昵称                │
│   [role badge]           │
│   N 帖子  |  编辑资料     │
├─────────────────────────┤
│  我的帖子                 │
│  [post item]             │
│  [post item]             │
│  ...                     │
├─────────────────────────┤
│  设置                    │
│  编辑资料     >          │
│  关于 Lucky   >          │
│  退出登录     >          │
└─────────────────────────┘
```

**Edit profile**: Bottom-sheet modal (wx.showActionSheet style) or inline form
to change nickname. Uses existing `updateProfile` cloud function.

**Stats**: Show post count extracted from the loaded myPosts list.

## Scope

**In scope:**
- Redesigned user card with gradient background, stats, edit button
- Single scrollable layout (no tabs)
- Settings menu: edit profile, about, logout
- Edit nickname modal (inline, no separate page)
- Post count display

**Out of scope:**
- Avatar upload (WeChat profile avatar is read-only from mini-program)
- Account deletion
- Notification settings
- Privacy settings
- Dark mode toggle
