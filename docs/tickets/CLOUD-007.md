# CLOUD-007: Real-time Messaging with watch()

| Field | Value |
|-------|-------|
| ID | CLOUD-007 |
| Parent | EPIC-002 |
| Status | DONE |
| Priority | high |
| Depends on | CLOUD-005 |

## Scope

- Implement mp-watch for chat: `watch.messagesBetween(peerOpenid, onChange, onError)`
- Chat page: open watch on load, close on unload
- New messages arrive in real-time via watch push
- Polling fallback when watch fails (setInterval 5s → messages.getConversation())
- "Connection unstable" banner when in polling mode
- Remove old mp-ws-client code entirely

## Out of Scope

- Online presence indicators
- Message read receipts (status tracking deferred)

## Design Decision Required

Messages collection is admin-only permission. Resolve watch compatibility before implementation:
- **Option A**: Use polling only (simpler, no permission issue)
- **Option B**: Change messages to creator-read/write, dual-write pattern
- **Recommendation**: Option A for MVP. Add Option C (notification cache collection) if chat becomes frequent.

## Refs

- `docs/design/cloudbase-migration/module_specs.json` (mp-watch, FM-011)
- `docs/design/cloudbase-migration/audit_report.json` (SC-002/BC-008 note)


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。

消息集合保持 admin-only，因此采用设计决策 A：轮询是唯一客户端传输通道。轮询按 `updated_at` 增量同步并按 `_id` 去重；出现连续同步错误时显示“连接不稳定，正在重试”，恢复后自动隐藏。
