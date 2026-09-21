# PR/FAQ: Post Editor Redesign — Draft System + Edit System

## Problem

The current post editor is a minimal form: title input, content textarea, category
pills, submit button. Three major gaps:

1. **No edit capability.** Once a post is published, it's immutable. Typos,
   updates, corrections — impossible without deleting and reposting.

2. **Single fragile draft.** One auto-save draft in local storage. If the user
   starts a new post before publishing the previous one, the old draft is
   overwritten and lost. No draft management at all.

3. **No safety net.** Close the editor or crash the app — the auto-save catches
   most cases, but the single-draft model means users can't keep multiple
   works-in-progress. No cross-device access (drafts are local-only).

## Solution

A unified editor supporting **three modes** via query parameter:

```
/pages/editor/editor?mode=create          → new post (default)
/pages/editor/editor?mode=edit&post_id=X  → edit existing post
/pages/editor/editor?mode=draft&draft_id=Y → continue draft
```

### 1. Draft System

```
┌─────────────────────────────┐
│ 发帖                  [草稿箱]│  ← nav bar with drafts button
├─────────────────────────────┤
│ 标题: [________________]    │
│       0/200                 │  ← character counter
├─────────────────────────────┤
│ 添加话题（可选）             │
│ [话题A] [话题B] [话题C]     │  ← category pills (unchanged)
├─────────────────────────────┤
│ 分享你的想法...              │
│                             │  ← content textarea
│                             │
│ 134/10000                   │  ← character counter
├─────────────────────────────┤
│ [    发布    ]              │  ← submit button (label changes per mode)
│ 草稿已自动保存 · 2秒前      │  ← auto-save indicator
└─────────────────────────────┘
```

**Drafts page** (accessible from editor nav bar):
```
┌─────────────────────────────┐
│ ← 返回        草稿箱        │
├─────────────────────────────┤
│ 如何学习 TypeScript   12:30 │  → tap to continue editing
│ 这是一篇关于 TS 入门的...   │
├─────────────────────────────┤
│ 周末去哪玩           09:15  │
│ 推荐几个北京周边的...       │
├─────────────────────────────┤
│ 无标题                昨天  │
│                           ← │  swipe left to delete
└─────────────────────────────┘
```

### 2. Edit System

- **My Posts page**: each post gets an "编辑" button (next to existing tap-to-view)
- **Editor in edit mode**: loads post data, pre-fills all fields. Submit label changes to "保存修改"
- **Permission**: cloud function verifies `post._openid === authenticated user` before allowing update
- **Category change**: if user changes category, `post_count` adjusts on both old and new categories
- **Sensitive word re-check**: updated content goes through the same filter as new posts

### 3. Editor Improvements

| Feature | Current | New |
|---------|---------|-----|
| Title validation | Cloud only | Client counter (0/200) + cloud |
| Content validation | Cloud only | Client counter (0/10000) + cloud |
| Auto-save | Every keystroke | Debounced 2s, cloud storage |
| Draft count | 1 (local) | Up to 50 (cloud + local fallback) |
| Submit feedback | Toast only | Button loading spinner + toast |
| Back safety | No warning | Emergency save on back navigation |
| Mode indicator | None | Nav bar title changes: "发帖" / "编辑帖子" / "继续编辑" |

## Customer Quote

> "以前写了一半的帖子，临时有事退出，回来就没了。现在草稿箱自动保存，还能存多个草稿，跟写邮件一样方便。帖子发错了也能改，不用删了重发。"

("Before, if I wrote half a post and had to leave, it was gone. Now drafts auto-save, I can keep multiple drafts, just like writing email. If I make a mistake in a post, I can edit it — no need to delete and repost.")

## Scope

### In scope
- [x] Unified editor with `create` / `edit` / `draft` modes
- [x] Multiple cloud drafts (max 50 per user)
- [x] Drafts list page with continue-editing + delete
- [x] Auto-save to cloud (debounced 2s) with local fallback
- [x] Publish clears source draft
- [x] Edit published posts (author only)
- [x] Client-side character counters (title 200, content 10000)
- [x] `update` action in posts cloud function
- [x] New `drafts` cloud function (save/list/delete)
- [x] Edit button on My Posts page
- [x] Emergency save on back navigation
- [x] Restore prompt for unsaved draft on editor open

### Out of scope
- [ ] Rich text formatting (bold, italic, links, images)
- [ ] Image/media upload
- [ ] Post preview before publish
- [ ] Scheduled publishing
- [ ] Collaborative editing
- [ ] Version history / edit diff
- [ ] Draft sync conflict resolution (last-write-wins for v1)
- [ ] Batch draft operations (select+delete multiple)

## FAQ

### Why cloud drafts instead of local storage?
Local storage is device-bound and limited (10MB). Cloud drafts sync across
devices and survive app reinstall. Local storage is kept as a fallback for
offline saves.

### Why 50 draft limit?
Prevents unbounded storage growth. 50 drafts is generous — most users have 2-5.
The limit is checked before save, and the UI warns when approaching it.

### What happens to drafts when a post is published?
The source draft (if the post was started from a draft) is deleted. The
published post exists independently. If the user started in create mode
(no source draft), nothing to clean up.

### Can I edit a post I published anonymously?
Yes. The edit preserves the original anonymous flag. Editing does not reveal
the author's identity for anonymous posts.

### What if two devices edit the same draft simultaneously?
Last-write-wins. The most recent save overwrites. This is acceptable for a
single-user draft system. Explicit conflict resolution is out of scope for v1.

## Topology Summary

```
editor-page (unified, mode-driven)
  ├── drafts-service ──→ drafts-cloud ──→ drafts-collection
  └── posts-service ──→ posts-cloud ──→ posts-collection

drafts-page
  └── drafts-service

my-posts-page
  ├── edit button → editor-page?mode=edit
  └── posts-service (unchanged list)
```

9 modules, 10 edges, 6 boundary conditions, 14 failure modes.
All 9 SC predicates PASS. Verdict: PROCEED.

## Tickets

| # | Ticket | Files |
|---|--------|-------|
| T1 | Add `IDraft` + `IUpdatePostData` types, `EditorMode` enum | `typings/cloudbase.d.ts` |
| T2 | Create `drafts` cloud function (save/list/delete) | `cloudfunctions/drafts/` (new) |
| T3 | Add `update` action to posts cloud function | `cloudfunctions/posts/index.js` |
| T4 | Extend posts service with `updatePost` | `miniprogram/services/posts.ts` |
| T5 | Create drafts service | `miniprogram/services/drafts.ts` (new) |
| T6 | Redesign editor page (modes, counters, cloud drafts, edit flow) | `miniprogram/pages/editor/` |
| T7 | Create drafts list page | `miniprogram/pages/drafts/` (new) |
| T8 | Add edit button to my-posts page | `miniprogram/pages/my-posts/` |
| T9 | Register drafts page in app.json | `miniprogram/app.json` |
| T10 | Integration: create→draft→edit→publish→delete flow test | Manual verification |
