# AUDIT-017: users 文档主键与读写方式不一致

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Severity | critical |
| Parent | null |
| Created | 2026-07-23 |

## Problem

设计约束 `docs/design/cloudbase-migration/module_specs.json` 明确要求 `_openid` 作为主键并手动设置；但 `cloudfunctions/users/index.js:52-62` 使用 `collection('users').add({ data: user })`，数据中只有 `_openid`，没有 `_id`。CloudBase `add` 会生成独立的 `_id`。

同一文件的查询、更新和回读，以及共享的 `checkAdmin`/`getAuthorSnapshot`，却都使用 `collection('users').doc(openid)`，也就是按 `_id === openid` 查询。首次创建后，这些路径无法找到刚创建的记录；若 `_openid` 有唯一索引，后续 `ensure` 还会在重复插入后回读失败。

## Impact

- 重启后的自动 `ensureLogin` 可能失败或产生重复用户记录。
- 修改昵称、公开资料页、管理员判断和作者快照可能全部失效。
- 用户已经存在时仍可能返回 `CREATE_ERROR`。

## Recommended Fix

统一采用 `users.doc(openid).set({ data })` 创建记录，或所有路径都改为按唯一 `_openid` 查询。前者与现有设计和多数调用点更一致；同时迁移已经使用随机 `_id` 创建的数据。

## Acceptance Criteria

- 同一 OPENID 连续执行多次 `ensure` 始终只有一条用户记录。
- `getProfile`、`updateProfile`、`checkAdmin` 和 `getAuthorSnapshot` 都能读取同一条记录。
- 有针对首次创建、重复 ensure 和历史数据迁移的集成测试。


## Resolution (2026-07-23)

用户统一通过 `_openid` 查询，更新使用实际文档 `_id`。
