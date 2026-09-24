# LynkU 文档入口

更新：2026-09-21。工程迁移进行中；运行时源码已归入 `apps/`，工程工具归入 `tooling/`。实际完成范围与待验证事项以[进度与证据](plans/refactor/status.md)为准。

## 从哪里开始

| 任务 | 首先阅读 |
|---|---|
| 启动 LynkU 与演示 | [演示入口](DEMO.md) → [迁移决策](architecture/decisions/002-lynku-cutover.md) → [实际证据](plans/refactor/status.md) |
| 执行完整重构 | [总计划](plans/refactor/plan.md) → [进度与证据](plans/refactor/status.md) |
| 查阅全项目深查与微信官方依据 | [LynkU 升级评估](diagnosis/lynku-upgrade-review-2026-09-21.md) → [既有计划中的实施顺序](plans/refactor/plan.md) |
| 查阅聊天界面、未读与消息提醒问题 | [聊天与通知诊断](diagnosis/chat-and-notification-review-2026-09-23.md)（历史复现；修复状态见唯一状态表） |
| 精修现有聊天交互细节 | [聊天 UI 体验调查](diagnosis/chat-ui-experience-review-2026-09-24.md)（调查建议；保持原位置和设计范式） |
| 精进匿名参与、聊天结构与视觉 | [匿名与消息体验方案](product/anonymous-messaging-experience.md) → [本地审核及配套迁移](runbooks/anonymous-messaging-refinement.md)（保持原 UI 范式） |
| 修复默认与匿名头像体系 | [头像系统分析与设计](product/avatar-system.md)（1 张匿名 + 4 张普通默认；已本地实现，待设备审核） |
| 开启后续长任务 | [可直接使用的任务指令](plans/refactor/goal-prompt.md) |
| 实施用户协议、举报、屏蔽和注销等上线保护 | [后续 goal 指令与顺序](plans/community-safety-goal.md) → [页面与功能边界](product/community-safety.md) → [完整协议文案](product/community-policies.md) → [技术契约与迁移](architecture/community-governance.md) |
| 了解目标结构 | [架构总览](architecture/target-architecture.md) → [模块边界](architecture/module-boundaries.md) |
| 了解现行工程结构及调研依据 | [结构与独立构建决策](architecture/decisions/001-project-structure.md) → [开发指南](DEVELOPMENT.md) |
| 判断哪些功能必须保留 | [产品与权限契约](product/behavior-contract.md) |
| 修改接口或数据库 | [接口、数据与一致性](architecture/contracts-and-data.md) |
| 编写与评审代码 | [工程规范](governance/engineering-standards.md) |
| 更新文档或处理历史设计 | [文档治理](governance/documentation.md) |
| 判断是否完成 | [质量与验收门槛](governance/quality-gates.md) |
| 准备发布、迁移与故障处理 | [发布与运行治理](runbooks/release-and-operations.md) |
| 尽快上线校园论坛、核对合规与运营准备 | [上线准备审查](audits/launch-readiness-2026-09-21.md) → [推荐路线与办事材料](runbooks/launch-preparation.md) → [唯一进度](plans/refactor/status.md) |
| 运行当前工程 | [当前开发指南](DEVELOPMENT.md) |

根目录 [AGENTS.md](../AGENTS.md) 是 Codex 协作入口；本页是文档导航，不复制各文档中的规则。

## 文档状态与权威性

- 上述产品、架构及治理文档是本轮目标规范。规范生效不代表相应代码已经实现。
- [进度与证据](plans/refactor/status.md) 是重构完成状态的唯一手工维护来源。当前代码行为和真实检查结果不能被文档状态替代。
- [源码初评](diagnosis/production-refactor-2026-09-21.md) 是排查起点，不是穷尽问题清单；其中旧阶段划分已被总计划取代。
- `design/`、`research/`、`tickets/`、`diagnose/` 以及其他旧诊断保存历史背景，不自动构成本轮实施要求。不要为了完成旧 ticket 而恢复已移除功能。
- 产品规则与实现冲突时记录差异并按目标修复；新用户明确要求可以更新目标规范，历史文档不能覆盖新要求。
- 本次上线保护以 [ADR 003](architecture/decisions/003-community-safety.md) 及上述专用设计为准：默认无人工预审，不增审核供应商或 AI，一套新协议直接切换；早期办事材料中的人工待审建议不再执行。本轮完成设计，未因此宣称代码已经实现。

## 已知旧文档偏差

现行 README/DEVELOPMENT 已按 `apps/`、`tooling/` 和独立函数产物更新；分类经云函数读取，已移除不存在的 clear-db 操作说明。历史诊断和 tickets 中的旧目录、旧行为保留为当时快照，不作为当前运行指令。
