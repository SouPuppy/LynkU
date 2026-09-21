# AUDIT-018: 匿名内容向普通用户暴露真实 OPENID

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | high |
| Severity | critical |
| Parent | null |
| Created | 2026-07-23 |

## Problem

匿名帖子和评论仍把真实 OPENID 同时写入顶层 `_openid` 与 `author._openid`：

- `cloudfunctions/posts/index.js:48-53`
- `cloudfunctions/comments/index.js:43-48`

`posts`/`comments` 又由客户端直接读取，因此隐藏头像和昵称只是一层 UI 处理，普通客户端仍可检查原始文档得到发布者身份。

通知路径还会直接泄露身份：`cloudfunctions/comments/index.js:96-125,138-176` 把真实 `actor._openid` 发给收件人，`components/notification-card/notification-card.ts:39-43` 点击匿名头像会直接打开该 OPENID 的公开资料页，并且通知中没有 `anonymous` 标记可供拦截。

这与资料页声明的“对其他用户隐藏你的身份信息”冲突。

## Recommended Fix

- 公共内容文档不要保存可被客户端读取的真实身份；所有权信息放入仅云函数可读的映射集合。
- 或将内容读取统一改为云函数，并对匿名记录移除 `_openid`/`author._openid` 后再返回。
- 通知保存并返回 `anonymous` 状态；匿名 actor 不返回可导航的真实 OPENID。

## Acceptance Criteria

- 普通用户从列表、详情、watch 快照和通知接口都无法获得匿名作者 OPENID。
- 匿名通知头像/昵称不可跳转到真实资料。
- 作者本人和管理员仍能通过受控服务端路径完成删除与审核。


## Resolution (2026-07-23)

帖子/评论/通知统一经云函数脱敏；匿名响应移除顶层和 actor/author OPENID，客户端不再 watch 私有集合。
