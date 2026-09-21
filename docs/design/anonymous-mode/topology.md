# Topology: Anonymous Mode + Theme System

> Phase 2 of design-pipeline.

## New Nodes

| ID | Name | Category | Responsibility |
|----|------|----------|----------------|
| N1 | `services/anonymous.ts` | Service | Single owner of anonymous mode state. Persists to storage, exposes toggle + get. |
| N2 | `app.wxss` (theme layer) | Config | CSS variable sets for real-name (blue) and anonymous (gray) themes. Root class toggle. |
| N3 | `app.ts` (theme init) | Entry Point | Reads anonymous state on launch, applies correct theme class + TabBar style. |
| N4 | `pages/profile/` (toggle UI) | UI | Switch control bound to `anonymous.toggle()`. Shows current mode label. |

## Modified Nodes

| ID | Name | Change |
|----|------|--------|
| M1 | `cloudfunctions/posts/index.js` | `createPost`: accept `anonymous` flag. If true, store `author: { _openid, nickname: '匿名用户', avatar_url: '' }`. Real openid stored in `_openid` field for moderation. |
| M2 | `cloudfunctions/comments/index.js` | `createComment`: same anonymous author logic. |
| M3 | `components/post-item/` | Display: if `post.author.nickname === '匿名用户'`, show anonymous avatar + label. |
| M4 | `components/comment-item/` | Same anonymous display logic. |
| M5 | `pages/index/index.ts` | Read anonymous state before posting, pass to cloud function. |
| M6 | `services/posts.ts` | `createPost` accepts optional `anonymous: boolean`. |
| M7 | `services/comments.ts` | `createComment` accepts optional `anonymous: boolean`. |
| M8 | `app.json` | TabBar selectedColor changes (static — set to blue as default). |

## Edges

```
N1 (anonymous.ts) → storage('anonymous_mode')    [owns state]
N3 (app.ts) → N1                                 [reads on launch]
N4 (profile) → N1                                [toggle]
M5 (index) → N1                                  [reads before posting]
M6 (posts service) → N1                          [reads anonymous flag]
M7 (comments service) → N1                       [reads anonymous flag]
M1 (cf-posts) → anonymous flag from event        [writes anonymous author]
M2 (cf-comments) → anonymous flag from event     [writes anonymous author]
N2 (theme) ← N3 (app.ts)                         [applies class by mode]
```

## Boundary Conditions

1. **Storage**: `anonymous_mode: boolean` in `wx.storage` — 1 byte, owned by N1.
2. **Trust**: Real `_openid` always stored server-side regardless of display mode.
   Admins can see real identity. Moderation actions (flag, delete) work the same.
3. **Consistency**: Author snapshot is written at create time and never updated.
   Changing anonymous mode does NOT retroactively change existing posts/comments.

## Deleted Nodes

None.

## YAGNI Gate

- Anonymous mode per-post toggle? NO — session-level toggle is sufficient.
  Per-post would add UI complexity without clear user need.
- Separate anonymous avatar images? NO — reuse existing default avatar.
- Anonymous mode expiry timer? NO — explicit toggle is clearer.
