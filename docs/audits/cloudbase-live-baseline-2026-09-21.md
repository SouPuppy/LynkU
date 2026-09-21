# CloudBase 线上基线（只读）

状态：已实现的只读审计，不代表环境已通过上线验收。采集时间：2026-09-21。

环境 `cloud1-d4g94y77f0a618eb5` 状态为 `NORMAL`，个人版，到期日为 2027-01-21。所有下列操作均为 CLI 只读查询；未创建集合、修改索引、部署函数或读取业务正文。

## 函数

云端共有 7 个活动函数：`common`、`users`、`posts`、`messages`、`login`、`comments`、`categories`。当前仓库生产清单应为 `users`、`posts`、`comments`、`messages`、`categories`、`drafts`。

- 缺少 `drafts`。
- `common` 不应作为独立生产函数部署。
- `login` 是旧兼容入口；在已确认所有受支持客户端升级前不得删除，切换后应受控退场。
- 已部署函数最后更新时间早于本次重构，且仍是旧版权限和返回 DTO 行为；不得将当前云端当作本地质量门禁已验证的版本。
- `users` 仍含历史邮件服务配置。其值未记录在此文档；切换前必须在云端轮换，并继续保持邮件认证暂停，直至单独完成邮件恢复验收。

## 数据库

现有集合：`users`、`posts`、`comments`、`messages`、`notifications`、`categories`、`email_verifications`。当前 schema manifest 需要 16 个集合，因此缺少 `drafts`、`draft_counters`、`comment_counters`、`comment_changes`、`conversation_counters`、`conversation_entries`、`notification_outbox`、`profile_outbox`、`rate_limits`。

审计时的只读计数为：users 48、posts 25、comments 20、messages 85、notifications 16、categories 6、email_verifications 4。

所有现有集合只见默认 `_id` 索引和历史 `_openid` 索引，尚未具备 schema manifest 所要求的复合、唯一和游标索引。不能在未建立索引、回填并核对数据前部署依赖新集合或游标的函数。

## 后续切换门槛

1. 备份或导出当前集合，并保存本审计的计数作为迁移前基线。
2. 通过受控迁移创建缺失集合、权限和索引；索引建成后重新只读核对。
3. 回填会话目录、序号计数器、评论变更与 outbox，运行计数和抽样一致性核对。
4. 轮换旧邮件服务密钥，保持认证暂停。
5. 部署兼容版本到隔离环境，通过真实事务、权限、游标与设备验收后才切换此环境；旧 `login`/`common` 仅在兼容窗口结束后移除。
