# LynkU 目标架构

状态：目标规范，工程迁移未完成。2026-09-21。`apps/` 与 `tooling/` 已落地，编辑器 feature 和消息数据库适配已接入；现行构建与依赖约束见 [ADR 001](decisions/001-project-structure.md)。其他业务模块仍按状态表继续迁移。

本文件确定系统形态与主要决策；[模块边界](module-boundaries.md)、[接口数据规范](contracts-and-data.md)定义详细约束，[执行计划](../plans/refactor/plan.md)是唯一阶段划分，[状态表](../plans/refactor/status.md)记录实施进度。

## 架构选择

采用**单仓库、业务模块化、严格 TypeScript、端口与适配器分离**的结构。小程序与服务端是不同运行时，各自编译和发布；业务模块不等于独立微服务或云函数数量。

保留原生小程序、Skyline/Glass-Easel 及 CloudBase 部署边界。微信 API、云数据库和邮件服务由适配层接入；领域规则和应用用例可以在没有这些真实平台的情况下测试。

2026-09-21 深查补充：平台决策以[微信官方文档对照及升级评估](../diagnosis/lynku-upgrade-review-2026-09-21.md)为依据。Page/Component、生命周期、setData、分包引用和实际 renderer 按官方行为设计；feature/ports 与模块所有权是本项目选择。微信文本审核使用异步端口，内容版本与审核结果绑定，外部调用不得放进可重试数据库事务。云 Node 24 是待隔离验证的升级候选，不代表现有 Node16 已升级；TypeScript 工具 API 兼容验证先于大版本替换。

项目以 Codex 为主要开发协作者，长期规则、决策和验收证据都保存在仓库。普通终端仍可执行构建、测试和排错。自动检查负责执行架构约束，指令文档负责解释约束与工作方式。

## 目标目录

以下为终态；不预先创建空目录，也不把旧目录迁移作为第一步。

```text
apps/
  miniprogram/
    app.ts / app.json / app.wxss
    pages/                      # 主包页面、路由及生命周期绑定
    components/                 # 纯展示组件
    features/                   # 主包业务状态与交互
    subpkg-chat/                # 聊天页面和分包专有业务
    platform/                   # wx 网络、存储、调度、导航适配
    composition/                # 组装 feature 与平台实现
  cloudfunctions/
    users/ posts/ comments/
    messages/ categories/ drafts/ # 协议入口和装配，保留外部函数名
packages/
  contracts/src/                # 各业务动作 schema、DTO、错误协议
  server/src/
    identity/                   # 身份、认证、公开资料
    content/                    # 帖子、分类、草稿
    interaction/                # 评论与回复
    messaging/                  # 会话、消息、读取和同步
    notifications/              # 通知投影与消费
    workflows/                  # 跨模块用例编排
    shared/                     # 最小平台无关能力接口/上下文
  adapters/src/
    cloudbase/                  # 仓储、事务、持久化与调度适配
    mail/                       # 邮件服务实现
tooling/                        # 构建、边界检查、环境、迁移与部署工具
tests/
  integration/                  # 入口、适配器、跨模块行为
  acceptance/                   # 完整场景及设备验收
docs/
  product/ architecture/ governance/
  plans/ runbooks/
dist/                           # 构建产物，不作为手工业务源码
AGENTS.md
```

业务模块按需要含 domain、application、ports 和公开 index；小模块不必形式化增加所有层。单元测试与代码就近放置。

共享 contracts 不导入 SDK，不共享私有数据库实体。服务端包不能进入小程序构建图。聊天实现不得因“共享”搬进主包导致分包失效。

## 已确定的决策

以下是本轮采纳的方向，实施者不需要重新征求普通确认；改变方向须说明新的证据与代价。

| 编号 | 决定 | 理由与代价 |
|---|---|---|
| D01 | 原生小程序/CloudBase 作为当前平台，业务与 SDK 分离 | 保住运行基础；代价是需要认真处理平台构建和测试边界 |
| D02 | npm workspaces 单仓库 | 沿用工具链、集中契约和锁定依赖；不引入第二套包管理器 |
| D03 | 严格 TS + 运行时 schema | 编译期与外部输入都受约束；接受边界映射和解码成本 |
| D04 | 模块唯一写入所有权，跨模块用例显式协调 | 避免身份/通知/内容互相写库；需要 UnitOfWork 与事件协议 |
| D05 | 小程序和每个函数独立产物 | 对齐真实上传边界；构建接管共享代码，淘汰 utils 手工副本 |
| D06 | CloudBase 原生身份，客户端会话为体验状态 | 不引入额外 JWT 系统；诚实区分本地退出与服务端凭据撤销 |
| D07 | 新公开协议使用独立 userId 和显式 DTO | 限制数据库标识外泄与类型混用；需要旧链接/协议兼容和映射迁移 |
| D08 | 消息优先使用会话级有序变更序列 | 避免只靠时间游标的遗漏；需验证事务竞争、成本及快照交接 |
| D09 | 持久化 outbox + 幂等消费者 | 消除读时修复依赖；需要受控后台调度及积压观测，不要求外部消息平台 |
| D10 | 逐业务切片替换，保留薄协议兼容层 | 分批发布和回退；每个兼容项必须有退出条件 |
| D11 | 仓库保存 Codex 规则与状态，检查器执行约束 | 降低长任务上下文丢失；维护短小且单一来源的文档 |

架构决策的产品后果以[产品契约](../product/behavior-contract.md)为准；接口与持久化语义以[接口数据规范](contracts-and-data.md)为准。

## 委托给实施者的选择

| 选择 | 阶段 | 要提供的证据 |
|---|---|---|
| schema/构建/静态/依赖图工具与版本 | R1 | 小程序兼容、独立云函数依赖、包体、违规样例 |
| Node/TS/云端 runtime 支持组合 | R1/R8 | 官方支持资料、配置核对、实际产物与云端执行 |
| 集合布局、索引及事务 port 实现 | R2–R5 | 权限、真实查询/并发、核对与回填方案 |
| 单调消息序列的具体实现或经证明的替代 | R3 | 同时间/并发/交接/过期游标对抗测试，成本与平台验证 |
| UI feature 内部状态组织 | R3/R6 | 生命周期、并发和离线恢复行为，避免全局重复状态 |
| 测试工具是否扩展、CI 宿主接入方式 | R1/R7 | 现有用例保留、统一命令、可复现失败与报告 |

这些选择有结论和验证即可继续，不要求额外长篇研究。需要改变 D01–D11 时按[文档治理](../governance/documentation.md)记录 ADR；未验证的猜想不能当作平台保证。

## 当前与目标之间的路径

原 miniprogram/cloudfunctions 基线已迁到 apps，页面路由和外部函数名保持。现有 workspace、契约、消息适配和编辑器 feature 继续作为迁移基础；后续收敛内容/通知、身份/草稿及其余前端业务，退出遗留 services/common 和 JS 业务。移动目录不等于这些业务已经全部迁移。

阶段编号仅使用 [R0–R8](../plans/refactor/plan.md)，此前 A–F 或初评中的阶段编号已被取代。原始诊断仍保留为证据，不能作为另一套执行顺序。

## Codex 项目指令依据

根 AGENTS 提供稳定规则和导航；有真实局部需要时再增加目录规则。官方说明支持根目录及更深目录的项目指令层次：[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。本项目不靠把所有设计塞入 AGENTS 获得质量，依赖图检查、契约和行为测试才是执行边界。
