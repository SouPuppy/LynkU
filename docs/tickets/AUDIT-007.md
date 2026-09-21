# AUDIT-007: No rate limiting on comments/drafts/messages

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

Only `posts` CF has rate limiting (`checkRateLimit`). `comments`, `messages`, and `drafts` cloud functions have no rate limiting. A user can spam comments, messages, or drafts without restriction.

## Fix

Copy the `checkRateLimit` pattern from posts CF to comments and messages CFs. Drafts are less critical (self-limiting by MAX_DRAFTS=50).


## Resolution (2026-07-23)

评论、草稿、消息均接入 `rate_limits` 持久限流集合。
