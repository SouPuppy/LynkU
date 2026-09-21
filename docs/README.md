# LynkU 文档入口

更新：2026-09-21。工程迁移进行中；运行时源码已归入 `apps/`，工程工具归入 `tooling/`。实际完成范围与待验证事项以[进度与证据](plans/refactor/status.md)为准。

## 从哪里开始

| 任务 | 首先阅读 |
|---|---|
| 启动 LynkU 与演示 | [演示入口](DEMO.md) → [迁移决策](architecture/decisions/002-lynku-cutover.md) → [实际证据](plans/refactor/status.md) |
| 执行完整重构 | [总计划](plans/refactor/plan.md) → [进度与证据](plans/refactor/status.md) |
| 开启后续长任务 | [可直接使用的任务指令](plans/refactor/goal-prompt.md) |
| 了解目标结构 | [架构总览](architecture/target-architecture.md) → [模块边界](architecture/module-boundaries.md) |
| 了解现行工程结构及调研依据 | [结构与独立构建决策](architecture/decisions/001-project-structure.md) → [开发指南](DEVELOPMENT.md) |
| 判断哪些功能必须保留 | [产品与权限契约](product/behavior-contract.md) |
| 修改接口或数据库 | [接口、数据与一致性](architecture/contracts-and-data.md) |
| 编写与评审代码 | [工程规范](governance/engineering-standards.md) |
| 更新文档或处理历史设计 | [文档治理](governance/documentation.md) |
| 判断是否完成 | [质量与验收门槛](governance/quality-gates.md) |
| 准备发布、迁移与故障处理 | [发布与运行治理](runbooks/release-and-operations.md) |
| 运行当前工程 | [当前开发指南](DEVELOPMENT.md) |

根目录 [AGENTS.md](../AGENTS.md) 是 Codex 协作入口；本页是文档导航，不复制各文档中的规则。

## 文档状态与权威性

- 上述产品、架构及治理文档是本轮目标规范。规范生效不代表相应代码已经实现。
- [进度与证据](plans/refactor/status.md) 是重构完成状态的唯一手工维护来源。当前代码行为和真实检查结果不能被文档状态替代。
- [源码初评](diagnosis/production-refactor-2026-09-21.md) 是排查起点，不是穷尽问题清单；其中旧阶段划分已被总计划取代。
- `design/`、`research/`、`tickets/`、`diagnose/` 以及其他旧诊断保存历史背景，不自动构成本轮实施要求。不要为了完成旧 ticket 而恢复已移除功能。
- 产品规则与实现冲突时记录差异并按目标修复；新用户明确要求可以更新目标规范，历史文档不能覆盖新要求。

## 已知旧文档偏差

现行 README/DEVELOPMENT 已按 `apps/`、`tooling/` 和独立函数产物更新；分类经云函数读取，已移除不存在的 clear-db 操作说明。历史诊断和 tickets 中的旧目录、旧行为保留为当时快照，不作为当前运行指令。
