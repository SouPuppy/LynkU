# R0 功能与工程基线

记录日期：2026-09-21。此文档描述开始重构时的实际代码路径和已确认差异，不将已知缺陷冻结为兼容要求。

## 运行单元

| 区域 | 当前入口 | 当前责任 | 迁移归属 |
|---|---|---|---|
| 主包 | `miniprogram/` 的 14 个页面与组件 | 显示、页面状态、服务调用 | apps/miniprogram 的 pages/components/features/platform |
| 聊天分包 | `miniprogram/subpkg-chat` | 对话展示、同步轮询与已读 | messaging feature，保持分包 |
| 用户函数 | `cloudfunctions/users/index.js` | 账户创建、资料、邮件认证、跨集合资料同步 | identity |
| 内容函数 | `cloudfunctions/posts/index.js`、`categories/index.js`、`drafts/index.js` | 帖子、分类、草稿、计数 | content |
| 互动函数 | `cloudfunctions/comments/index.js` | 评论、回复、计数和通知触发 | interaction/workflows |
| 消息函数 | `cloudfunctions/messages/index.js` | 私信、会话列表、通知读取/回填 | messaging/notifications |
| 公共工具 | `cloudfunctions/common/index.js` + 每函数 `utils.js` 副本 | 校验、鉴权、限流、计数、匿名帮助器 | 拆为模块能力与平台适配器 |

## 动作与访问矩阵

下表以代码截至本基线的调用方式为依据。`目标`表示重构后必须达到的权限，不把当前客户端拦截当作服务端授权。

| 函数/动作 | 当前调用方 | 当前服务端最低校验 | 目标 |
|---|---|---|---|
| users.ensure | 显式微信登录 | CloudBase OPENID | 主动登录时创建/读取账户 |
| users.updateProfile | 设置 | OPENID + 账户存在 | 仅本人账户 |
| users.getProfile | 他人资料页 | OPENID，目标标识 | 已登录用户，仅公开 DTO |
| users.sendEmailCode/verifyEmailCode | 旧认证页 | 暂停开关先拒绝 | 保持暂停，后续仅本人认证流程 |
| posts.list/get/search | 首页、搜索、详情 | `public_only` 降低视图权限 | 游客可读已发布公开内容 |
| posts.create/update | 编辑器 | 已认证 | 已认证 + 作者/状态/幂等/版本 |
| posts.delete | 详情、我的帖子 | 作者或管理员；已删除先返回 | 先授权后幂等，作者或管理员 |
| posts.flag | 管理入口 | 管理员 | 管理员，记录审计 |
| comments.list | 帖子详情 | 已发布帖子 | 游客可读已发布评论 |
| comments.create | 帖子详情 | 已认证 | 已认证 + 内容/父评论/幂等 |
| comments.delete | 评论项 | 作者或管理员；已删除先返回 | 先授权后幂等 |
| messages.send | 聊天分包 | 已认证 | 已认证 + 会话成员 + 幂等 |
| messages.listConversations/getConversation/syncConversation/markRead | 私信页、聊天分包 | 当前 send 以外未统一认证 | 已认证 + 会话成员 + 普通/匿名隔离 |
| messages.listNotifications/getUnreadNotificationCount/markNotificationsRead | 私信页、角标 | 当前读取触发回填 | 已认证 + 本人；读取不做全表修复 |
| categories.list | 首页、编辑器 | CloudBase OPENID | 所有会话可读可用分类 |
| categories.seed/create/update | 管理入口 | 管理员 | 管理员，种子仅受控环境 |
| drafts.save | 编辑器 | 已认证 | 已认证 + requestId/版本/数量边界 |
| drafts.list/delete | 编辑器、草稿页 | 当前未统一认证 | 已认证 + 本人；删除先授权后幂等 |

## 已确认的差异和归属

| ID | 当前差异 | 归属 | 验收 |
|---|---|---|---|
| B01 | 私信、草稿和通知的部分读取缺少服务端统一认证 | R2 | A02 |
| B02 | 普通会话条件没有明确排除匿名上下文 | R3 | A04 |
| B03 | 消息同步以 `updated_at` 为唯一游标，并在无时间推进时停止翻页 | R3 | A05 |
| B04 | 会话目录只聚合最近 200 条收/发消息 | R3 | A06 |
| B05 | 发帖、评论和初次草稿保存无统一请求幂等 | R4/R5 | A07 |
| B06 | 通知读取会扫描帖子和评论并尝试回填 | R4 | A09 |
| B07 | 评论轮询递归读取完整评论树 | R4/R6 | A15 |
| B08 | 资料变更直接跨集合更新作者/通知快照 | R5 | A09 |
| B09 | 离线草稿键不按账户隔离 | R6 | A10/A11 |
| B10 | `checkRateLimit` 存储失败时全局 fail-open | R5 | A12/A15 |
| B11 | 删除逻辑存在权限前的已删除快捷返回 | R2/R4 | A02/A08 |

“确认”只代表源码审查的确定路径；R2–R6 必须先补针对性行为测试，再将修复标记为完成。

## 已知工程基线

- Git HEAD：`7c78ef3976811caf776582e9fc201096058f2a25`；工作区存在用户/先前任务改动，尤其 `miniprogram/app.json`，不得在重构中覆盖。
- 初始完整检查曾为 30 项；R1 新增消息游标测试后为 32 项。
- 本机观测为 Node v24.21.0、npm 11.19.0、TypeScript 5.9.3。CloudBase runtime 与微信开发者工具没有在本地基线中验证。
- 云函数生产依赖目前使用 `wx-server-sdk: latest`，公共工具依赖部署前复制；两项均列入 R1/R7 的构建治理，而非当前已解决事实。
