# PR/FAQ: Comment System Completion

> Date: 2026-07-21
> Depth: Shallow — existing architecture, UI completion + minor backend additions
> Tickets: 5 child tickets under one epic

## Problem

The comment system skeleton is in place — cloud function handles create/delete
with depth enforcement, client service builds a 2-level tree, and a
`comment-item` component renders nested replies. But **none of it is wired up**.
The send button on the post page doesn't work. There's no way to reply to a
comment. You can't delete your own comments. Real-time updates exist in the
service layer but aren't used. And the comment-item component has stale
placeholder types that don't match the actual data model.

Users can see comments, but they can't participate. The comment system is
read-only in practice.

## Solution

Five tightly-scoped changes, all within existing modules:

1. **Wire comment input bar** — bind the send button in `post.ts`, add top-level
   comment submission, refresh the comment list after posting.

2. **Add reply UI** — tap a comment to reveal an inline reply input. Uses the
   existing `parent_id` field in the cloud function. Max depth enforced server-side
   (comment → reply, no deeper).

3. **Add delete action** — long-press your own comment to delete. Confirmation
   dialog. Soft-delete (status = 'deleted'), existing cloud function handles it.

4. **Integrate real-time watch** — subscribe to comment changes on the post page
   via `watchComments()`. New comments and deletions appear without manual refresh.

5. **Clean up stale types + add states** — remove the unused local `Reply`
   interface from `comment-item.ts`. Add proper loading/empty/error states for
   the comments section. Handle the edge case where a deleted parent still has
   visible children.

## Customer Quote

> "Before: I could read comments but the send button did nothing. There was no
> reply button. It felt broken. After: tap to reply, long-press to delete, new
> comments appear in real time. Feels like a real forum now."

## FAQ

**Q: Why not add comment likes?**
A: Out of scope for this iteration. Likes add a new collection (comment_likes),
count denormalization, and toggle logic. That's a separate design.

**Q: Why not add comment editing?**
A: Out of scope. Editing requires tracking edit history or at minimum an
`edited_at` flag. Adds complexity without clear user demand for a small forum.

**Q: How does reply nesting work?**
A: Two levels: top-level comment + one level of replies. The cloud function
already enforces `depth <= 1`. The UI shows a "回复" (reply) link on each
top-level comment that reveals an inline input. Replies to replies are
rejected server-side.

**Q: How does real-time work?**
A: `watchComments()` uses CloudBase's `watch()` API. On change, the comment
list is rebuilt from the snapshot. The `watch()` is closed on page hide to
avoid leaks.

**Q: What about comment count?**
A: The cloud function increments `comment_count` on create, decrements on
delete. The post page already displays this count. Real-time watch keeps it
in sync.

**Q: How does the comment-item component handle deleted comments?**
A: Deleted comments show "[评论已删除]" placeholder text. Their replies
(if any) remain visible. This is consistent with how most forums handle
soft-deletes.

## Scope

**In scope:**
- Wire send button → submit top-level comment → refresh list
- Add reply UI to `comment-item` component (inline input on tap)
- Add delete action (long-press own comment → confirm → delete)
- Integrate `watchComments()` in post page for real-time updates
- Clean up stale `Reply` interface in `comment-item.ts`
- Add loading/empty/error states for comments section
- Handle deleted-comment display edge case
- Admin can delete any comment (server-side check already in place: owner or admin)

**Out of scope:**
- Comment likes / reactions
- Comment editing
- Comment pagination (current 200 limit is fine for launch)
- Admin flag/hide (separate moderation feature)
- Push notifications for comment replies
- Rich text / markdown in comments
- @mentions

## Tickets

| # | Title | Description |
|---|-------|-------------|
| COMM-001 | Wire comment input bar on post page | Bind send button to `createComment()`, add input state, refresh list after post |
| COMM-002 | Add reply UI to comment-item | "回复" link on top-level comments → inline reply input → submit with `parent_id` |
| COMM-003 | Add delete with long-press | Long-press own comment → confirm dialog → `deleteComment()` → refresh |
| COMM-004 | Integrate real-time comment watch | Start/stop `watchComments()` in post page lifecycle, rebuild tree on snapshot change |
| COMM-005 | Cleanup types + edge cases + states | Remove stale `Reply` interface, add deleted-comment placeholder, add loading/empty/error states |
