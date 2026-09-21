# AUDIT-011: Message idempotency TOCTOU — duplicate messages possible on retry

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`cloudfunctions/messages/index.js:27-44` — `msg_id` deduplication has a TOCTOU race. The pre-insert check and the insert are not atomic. Under network retry (double-tap send), both calls can pass the check and both insert.

## Fix

Use a CloudBase unique index on `msg_id`, or use a transaction. Ponytail: accept rare duplicates (idempotency is client-side via `msgId = Date.now() + random` which already prevents most collisions).


## Resolution (2026-07-23)

消息文档 ID 由发送者和 msg_id 的稳定 SHA-256 键确定，并在事务中写入。
