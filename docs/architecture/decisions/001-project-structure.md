# ADR 001：源码边界与独立云函数构建

日期：2026-09-21。状态：采纳；实施与验收进度以[唯一状态表](../../plans/refactor/status.md)为准。细化 D02/D05/D11，不更换原生小程序或 CloudBase，不变更 AppID、产品权限及云端数据。

## 问题

已有 workspace 契约和服务端用例可复用，但页面承担业务流程，云函数混合数据库适配与入口，公共 `utils.js` 存在多个源码副本。目录依赖主要靠文本匹配检查；本轮真实依赖图发现契约中的类型循环。仅移动目录不能消除这些问题，工作区的 npm 链接也不能直接作为每个云函数上传后的依赖。

## 决定与依据

| 决定 | 理由与官方依据 |
|---|---|
| `apps/miniprogram` 保存小程序源码，`apps/cloudfunctions` 保存六个函数入口；`tooling` 负责构建与检查，`scripts` 保留运维及数据迁移命令 | 小程序根目录与云函数上传目录由项目配置分别指定；微信[官方示例配置](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/project.config.json)已有 `miniprogramRoot`、`cloudfunctionRoot` 和 TypeScript 插件。使用示例核对配置机制，不把示例当作本项目已通过开发者工具验收的证据。 |
| 保留单仓库 npm workspaces：`contracts`、`server`、`adapters` 只按实际职责建立 | npm [workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)提供工作区安装与包名链接，减少手工副本；它不代替发布打包。 |
| 编辑器通过 feature、ports、platform、composition 分离业务状态、能力接口、微信实现与装配；消息数据库能力进入严格 TS 的 `packages/adapters` | 业务可以用注入的存储、会话、调度和事务能力验证，页面及云函数保留实际平台入口。其他功能按相同边界迁移，不预建空模块。 |
| 每个函数由 esbuild 从源码打成独立 CommonJS `index.js`，仅 `wx-server-sdk` 与 Node 内置模块留在运行时；输出独立 `package.json`、`config.json` | TypeScript [`paths`](https://www.typescriptlang.org/tsconfig/paths.html)不会改写生成代码的导入路径；必须由构建解析 workspace 源码。[esbuild bundle/external](https://esbuild.github.io/api/#external)支持内联内部依赖并保留外部 SDK；SDK 仍须在部署时安装。[CloudBase 部署说明](https://docs.cloudbase.net/cli-v1/functions/deploy)按函数目录读取代码与包配置，并明确区分云端安装依赖与上传本地依赖。 |
| `config/cloud-runtime` 保存唯一 SDK 运行时依赖清单与 npm lock；每个函数产物包含完整 `package-lock.json` | 精确的 SDK 版本不能固定其传递依赖；npm [锁文件](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)记录依赖树、下载地址和完整性摘要。构建仅替换锁文件顶层及根包的 name/version，保留全部传递项；产物检查逐项核对完整锁文件。该目录不加入开发 workspaces。 |
| 删除各函数的 `utils.js` 源码副本，公共实现只有一个源码入口；开发者工具和 CloudBase 均指向 `dist/cloudfunctions` | 保留单一维护来源，同时让每个上传目录不依赖其他函数目录、仓库 workspace 链接或仓库外路径。 |
| dependency-cruiser 18.4.0 检查解析后的依赖图，并启用类型依赖；平台全局变量另用 TypeScript AST 检查 | 官方[规则文档](https://github.com/sverweij/dependency-cruiser/blob/v18.4.0/doc/rules-reference.md)支持循环、来源/目标及公共入口约束；[选项文档](https://github.com/sverweij/dependency-cruiser/blob/v18.4.0/doc/options-reference.md)说明类型依赖需显式纳入。规则覆盖 SDK、跨业务内部导入、主包引用聊天分包及 feature 平台耦合；安装后的外部 SDK 依赖边仍保留在图中。 |

本地工程以 Node 24.21.0、TypeScript 5.9.3 验证；dependency-cruiser 的[版本声明](https://github.com/sverweij/dependency-cruiser/blob/v18.4.0/package.json)支持 Node 22/24/26+。云函数部署清单当前仍为 `Nodejs16.13`，构建语法目标与其对齐；工程 Node 版本不代表云运行时已升级，也不证明该云运行时的实际支持与 SDK 行为。

## 代价与未完成边界

- 开发者工具项目、测试、脚本、相对路径及文档必须同批更新；产物必须重新构建，不能继续直接上传函数源码目录。已有未提交页面配置随目录迁移保留。
- esbuild 不执行类型检查，严格类型检查仍是独立门槛。bundle 会包含所需的共享代码；包体和设备运行需要分别验证。
- 旧客户端 `services` 及尚未迁移的云函数 JavaScript 业务仍存在。编辑器和消息适配器切片建立真实边界，不代表全栈严格 TS、全部页面薄化或数据所有权迁移已完成。
- 本地隔离产物验证使用受控 SDK 替身；不证明云端 SDK 安装、实际事务、索引、身份或邮件链路。微信开发者工具、真机和隔离云环境属于 G3/G4、R8。
- SDK 沿用 4.0.2。运行时锁文件生成时 npm 报告 6 项传递依赖风险（1 moderate、5 high）；本轮没有执行强制升级或宣称消除这些风险。锁定现有依赖与修复 SDK 供应链风险是不同的工作。

## 验证、迁移与撤回

已单独执行 `node --import tsx --test tests/architecture.test.mjs`，25 个架构文件夹具通过；`npm run check:cloud-artifacts` 构建并验证六个独立函数，核对部署运行时/构建目标、SDK 精确版本、配置、文件摘要和外部依赖声明。消息产物通过真实 `main` 执行游客拒绝及已认证会话目录读取，穿过授权、契约、服务端和数据库适配器，并验证匿名身份不泄漏。数据库与 SDK 在该试验中为合成替身。

运行时锁文件使用 `npm install --package-lock-only --ignore-scripts --prefix config/cloud-runtime` 生成，固定 SDK 与传递依赖且未安装该目录的 `node_modules`。构建检查源 SDK、运行时清单与锁记录一致，并拒绝缺失的传递依赖、摘要和工作区链接；产物检查完整比较每份锁文件。`npm ci --dry-run --ignore-scripts --no-audit --no-fund --prefix dist/cloudfunctions/messages` 已验证一个重命名产物的锁文件能被 npm 使用，未实际安装依赖。发布时仍须确认平台安装行为遵循该锁文件，不能把本地结构核对当作真实部署证据。

本轮完整 `npm run check` 已通过，205/205 测试通过；仓库外源码副本从 `npm ci --ignore-scripts` 干净安装后重复完整检查，同样通过。严格类型、编辑器生命周期/恢复、消息适配器行为及产物等 G1/G2 证据见[状态表](../../plans/refactor/status.md)。这不替代 G3/G4 云端与设备验收。

旧 `utils.js` 副本退出后不保留双写生成机制。契约类型循环通过在公共 `index.ts` 导出响应别名消除，包级 API 不变；身份模块补公开入口。回退应整体恢复源码、构建及配置后重新生成产物，不能混用新源码与旧上传目录。本轮没有数据库结构修改或真实数据清理；若云端运行时或小程序分包验证否定构建假设，依据实测调整该决策并保留失败证据。
