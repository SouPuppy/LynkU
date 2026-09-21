# AUDIT-026: 部署脚本遗漏 drafts 且仍引用已删除的 login

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Problem

部署入口之间已经漂移：

- `scripts/deploy-functions.sh:19-21` 只部署 `users posts comments messages categories`，把 `drafts` 标成可选。
- 编辑器每次输入后都会调用 `drafts` 自动保存，草稿页也直接依赖它，因此它不是可选功能。
- `scripts/create-and-deploy.sh:10` 仍包含已经删除的 `login`，同时遗漏 `drafts`。
- `docs/DEVELOPMENT.md` 仍描述旧的 `cf-login`/`cf-*` 目录和 5 个集合，遗漏 `drafts`、`notifications` 与当前真实目录名。

全新环境按文档和脚本部署后，编辑器自动保存会持续失败，创建脚本还会尝试部署不存在的路径。

## Recommended Fix

建立唯一的函数清单并由两个脚本复用，至少包含 `users posts comments messages categories drafts`；明确排除生产 `clear-db`。同步更新数据库集合、索引、权限和部署文档。

## Acceptance Criteria

- 全新环境执行标准部署流程后，所有客户端调用的云函数都存在。
- 脚本不再引用 `cloudfunctions/login`。
- `clear-db` 不在生产默认清单中。
- DEVELOPMENT 文档中的目录、集合和脚本与仓库一致。


## Resolution (2026-07-23)

两个部署脚本复用 functions.sh，部署 users/posts/comments/messages/categories/drafts，排除 login 和 clear-db；开发文档已同步。
