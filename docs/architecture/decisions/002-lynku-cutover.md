# ADR 002：LynkU 成为唯一主工程

日期：2026-09-21。状态：采纳，实际验证记录见[状态表](../../plans/refactor/status.md)。

用户授权迁入 LynkU、初始化环境并向可演示状态收敛，确认继续使用原生微信与 CloudBase。继承 Lucky 已实现的 apps/packages/tooling 边界，不引入 Taro/React 或第二套身份服务。

## 工程与配置

- LynkU 保留原 Git 历史和 AppID `wxba2bcb0c71a5f33d`；接收 Lucky 的完整业务、测试、架构与治理文档。
- 公开配置唯一入口为 `config/project.json`；`npm run configure` 同步客户端、微信工程和云部署目标。`npm run check` 拒绝配置漂移；配置中不接受秘密字段。根包改名为 lynku，内部 @lucky 包名暂留以保持稳定导入，不维护两份源码。
- 新环境 `cloud1-d7gifgdpb8ad0ab8e` 来自新 AppID 的微信开发者工具环境列表。旧环境 `cloud1-d4g94y77f0a618eb5` 不再是本工程部署目标。CloudBase CLI 当前腾讯云凭据只可访问旧环境，微信 CLI 使用新 AppID 自身授权；不能因 CLI 身份不同而误投旧环境。
- 根 `npm run setup` 执行锁定安装、配置与完整检查；客户端展示名称使用同一配置。

## 数据与回退

新 AppID 和新环境独立初始化，不按昵称、邮箱前缀或旧 OPENID 自动绑定真实用户。旧账号、邮箱认证、内容和私信保留在旧环境和私人备份中，后续迁移必须有真实身份关联证据。不能把新环境演示成功称为历史数据迁移完成。

模板原文件完整保存在忽略的 `dist/private-backups/lynku-template-20260921`。原身份迁移的 `identity-20260921` 私人备份已复制并逐文件核验；不提交到 Git，不打入小程序或云函数。旧 Lucky 目录仍可用于恢复，不对两个源码目录继续双写。

本地类型/测试通过只证明 G1/G2；新环境部署、真实微信登录、设备渲染和认证分别记录 G3/G4 证据。邮箱开关只能在服务端邮件与绑定流程验证后启用，不能为演示绕过认证。
