# AUDIT-029: 聊天轮询用 _id 比较新旧消息会漏消息或重复追加

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`services/watch.ts:90-105` 每 4 秒拉取最近 30 条消息，然后用 `m._id > lastId` 判断新消息。CloudBase 自动生成的 `_id` 不是该接口中声明的时间游标，代码也没有按 `msg_id`/`_id` 去重。

结果可能包括：

- 新消息的 `_id` 字典序较小而被永久漏掉。
- 最近 30 条中的旧消息字典序较大，被反复追加。
- 本地刚发送并已经插入列表的消息被轮询再次追加。

轮询回调只追加消息，也不会把已有发送消息的 `status` 更新为 `read`，活跃聊天收到的新消息也要到页面卸载时才统一标记已读。

## Recommended Fix

使用 `(created_at, _id)` 服务端游标或专用单调序列查询增量；合并结果时按消息 `_id`/`msg_id` 去重并更新已有对象状态。收到新消息后立即标记对应消息已读。

## Acceptance Criteria

- 连续发送、双方交替发送和轮询重试均不会出现重复或漏消息。
- 对方已读后，现有气泡状态能从 sent 更新为 read。
- 活跃聊天收到的消息会及时从未读统计中移除。


## Resolution (2026-07-23)

聊天按 updated_at 增量同步，按 _id 合并去重并传播 sent/read 状态。
