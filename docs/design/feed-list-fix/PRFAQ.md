# PR/FAQ: Homepage Feed — Duplicate Fix + Infinite Scroll

> Date: 2026-07-22
> Depth: Shallow — bug fix + existing skeleton completion

## Problem

**Bug — posts appear twice.** `onLoad()` calls `loadPosts()` (no reset), then
`onShow()` calls `loadPosts(true)` (reset). Both fire on first page load.
Race condition: if onLoad's async request returns AFTER onShow's request,
it appends to the already-populated list → duplicates.

The code even has a comment acknowledging the double-fetch:
`// ponytail: refresh on show so posts from editor appear. Double-fetches with onLoad on first mount — acceptable.`
It's not acceptable.

**Missing feature — no infinite scroll.** The page has `onLoadMore`, `hasMore`,
and `offset` state. The scroll-view has `bindscrolltolower="onLoadMore"`.
But the `onShow` reset combined with the double-fetch breaks the append
logic — the user never sees more than one page.

## Solution

**Fix duplicate bug**: Track whether the page has already loaded. `onLoad`
does the initial load. `onShow` only refreshes if NOT the first render.

**Infinite scroll**: Already structurally implemented. The existing
`listPosts({offset})` returns paginated results. `onLoadMore` appends.
The only fixes needed: (a) remove the double-fetch, (b) ensure `hasMore`
is correctly calculated from the API response.

## Scope

**In scope:**
- Fix duplicate posts (add `_loaded` guard flag)
- Ensure infinite scroll appends correctly
- "没有更多了" footer when `hasMore` is false
- Pull-to-refresh resets and reloads

**Out of scope:**
- Cursor-based pagination (offset is fine for this scale)
- Skeleton loading for more items
- Pull-to-refresh animation customization
