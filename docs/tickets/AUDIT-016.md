# AUDIT-016: clear-db 云函数缺少身份与管理员校验

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Severity | critical |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`cloudfunctions/clear-db/index.js:54-81` 只检查请求中的 `action` 和写死的 `confirm: 'DELETE_ALL'`，没有通过 `context.OPENID` 验证调用者，也没有执行管理员检查。这个确认字符串已经出现在源码和函数错误提示中，不是权限边界。

一旦该函数被部署，任意能调用小程序云函数的用户都可以删除 `posts`、`comments`、`messages`、`notifications`、`categories`、`users` 和 `drafts` 的全部数据。

## Recommended Fix

- 默认不在生产环境部署 `clear-db`。
- 必须保留时，使用 `withAuth` + `checkAdmin`，并增加仅服务端可配置的环境开关。
- 删除过程中不要吞掉单条删除错误；返回实际成功/失败数量。

## Acceptance Criteria

- 普通用户即使传入正确确认字符串也只能得到 `FORBIDDEN`。
- 生产部署脚本不会包含该函数。
- 管理员清理操作有审计日志，且部分失败不会被计入 `deleted`。


## Resolution (2026-07-23)

清库要求管理员、显式环境开关、精确环境 ID 和随机秘密，并记录审计日志；生产清单排除该函数。
