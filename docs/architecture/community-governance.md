# 校园社区治理、身份授权与数据权利技术设计

状态：**目标规范，实施与验收须按代码逐项核对**。日期：2026-09-21。本文件是后续实施的技术设计，不是已上线功能、已完成行政手续或安全合规通过声明；文中的目标 action、集合、工作者和界面不能仅凭本文当作当前已可用。当前可用检查仍以根 `package.json` 为准，本设计没有新增命令。

用户要求本轮只完成完整方案，后续由 goal 实施。当前代码还有其他任务的并行修改；恢复实施时须先检查工作区和[唯一状态表](../plans/refactor/status.md)，不能把本文件作为覆盖那些修改的依据。现有事实见[上线审计](../audits/launch-readiness-2026-09-21.md)及[技术审计](../diagnosis/lynku-upgrade-review-2026-09-21.md)。本文件定义技术契约与数据责任；页面和产品默认以[上线保护功能方案](../product/community-safety.md)为准，保留期限及正式条款以[协议与隐私文案](../product/community-policies.md)的唯一表为准，不在此维护另一份日期。外部准入结论由[上线准备手册](../runbooks/launch-preparation.md)维护。

## 1. 已选边界与实施约束

1. 保留原生微信小程序、CloudBase、单仓库；新增第 7 个 `governance` 薄云函数，只拥有举报、个案处置、申诉和审计入口。其业务位于 `packages/server` 的governance模块，不另建网站、HTTP后端、JWT身份系统或微服务。
2. 保留现有六个业务函数。新函数与原函数共享同一个数据库事务能力；跨模块处置由 workflows 调用各模块公开接口，在同一 UnitOfWork 内执行，不串联远程云函数调用来伪装原子事务。
3. 工作台是小程序内权限受控的最小分包。原[产品契约](../product/behavior-contract.md)排除全新管理后台，此次只补履行社区治理职责所需的受控操作界面；该范围修订须随实施同步，不扩展运营 CMS、用户画像、任意私信查看或批量导出。
4. 新业务、适配器、契约及测试使用严格 TypeScript；未知输入先验证。数据库记录、管理证据、公开 DTO 和页面状态分别建模，不通过展开完整数据库记录构造响应。
5. `account_lifecycle` 是唯一账户生命周期与写入屏障记录，统一 `state/epoch/writeFence/restrictions`。不同时建立 `account_access` 等第二份账户状态。
6. 内部 `accountId` 和公开 `publicUserId` 独立生成；本次与现有公开 ID 目标合并迁移，不再启动另一套身份改造。可信微信标识仅留 identity 和受控服务端适配范围。
7. 首次身份持久化时机有意修订：唯一基础身份仍为微信，无微信／游客二选一；先告知、无有效处理依据时瞬时识别，明确同意后自动初始化同一个微信账号。不能将其描述为原行为完全不变。
8. 用户最新修订：不做默认人工审稿，不建预审队列，不让正常发布依赖管理员在线。只接微信平台要求的自动安全检查，通过后在当前请求中提交；review/risky阻止本次提交，失败保留编辑内容供用户主动重试。帖子、评论、昵称和私信遵循相同原则。
9. 不静默缩减帖子、标题、评论、昵称或私信的现有正文上限。检查能力、配额或延迟不足时明确本次未提交并保留编辑内容，不截短或只检查前段。

第 7 个入口的代价是增加一个独立构建、配置、部署及 ACL 验收单元；相比把案件塞入 users 或 categories，它避免身份、分类与投诉证据耦合。业务所有权与部署数量无一一对应要求，后续不按集合数继续拆函数。外部依赖预算限现有微信／CloudBase、现有已授权邮件服务，以及微信要求的自动内容检查；不新增第三方审核商、AI模型、工作流SaaS、后台托管或队列中间件。检测故障仅阻止相应新写入，公开浏览、已有内容、草稿恢复和权利入口保持独立可用。

## 2. 所有权和依赖方向

| 模块 | 唯一写入责任 | 跨模块公开能力 |
|---|---|---|
| identity | users、可信身份映射、account_lifecycle、授权记录、学校认证、隐私请求及注销任务检查点 | Principal、当前写许可、本人权限状态、处罚变更、资料版本提交、本人数据副本与清理能力 |
| content | posts、categories、drafts、版本与提交幂等结果 | 当前可见性、绑定检查结果的发布／编辑／下架、分类计数、案件证据、本人数据清理 |
| comments／interaction | comments、回复关系、提交幂等结果、评论变化序列 | 绑定检查结果的创建／删除、证据和删除占位；通过 content 能力修改帖子计数 |
| messaging | 消息、会话目录、序列、拒收偏好、屏蔽关系、治理变化事件 | 成员授权、发送屏障、精确消息取证、历史和同步、本人数据副本与删除脱敏 |
| notifications | 通知、收件人、已读、内容撤回后的投影 | 幂等投递、撤回／脱敏、本人通知清理；从不在读取时修复全量历史 |
| moderation | 纯检测计划与结论规则；元数据由对应业务提交操作记录持有 | 同步、限时返回绑定不可变请求摘要的结论；无发布队列、无后台发布worker、不直接写公开资源 |
| governance | 案件、证据副本、决定、访问和操作审计、结果通知事件 | 接案、复核、申诉及形成不可变决定；不直接改其他模块的集合 |
| workflows | 跨模块流程，无独立通用业务实体 | 处置＋资源状态／处罚＋审计＋outbox 原子提交，按模块清理数据 |

moderation 是 server 内的窄能力，不新增部署单元；内容／资料／私信原入口在当前请求内通过同一接口使用检测适配器，governance不承担自动审稿调度。SDK、环境变量、供应商字段和数据库事务对象只由 adapters 处理。适配器可实现跨集合事务，但向应用层只提供有语义的能力，禁止 `collection(name)` 逃生口。

## 3. 微信身份、授权与账户状态

### 3.1 标识和生命周期

- `lifecycleId`：服务端以带版本密钥的 HMAC 对 AppID 与可信 OPENID 派生，仅内部使用。跨 AppID 不自动映射，不根据昵称、邮箱前缀推断同一人。密钥轮换须有双读迁移和墓碑可定位验证。
- `accountId`：不可猜测的随机内部 ID，不从 OPENID 或 publicUserId 派生。既有 users 文档 `_id` 与账号／认证不因迁移重建；增加显式映射和唯一索引。
- `publicUserId`：独立随机公开 ID，供实名资料／作者跳转使用。匿名 DTO 不包含它、accountId、lifecycleId、OPENID 或可归并多个匿名来源的标识。
- `account_lifecycle.state`：`active → closing → closed`。明确重新加入才从 closed 为新代际建立全新 accountId/publicUserId；ensure 不能自动复活旧账号。
- `epoch`：非负安全整数，关闭、重新加入及需要整体撤销旧任务的事件递增；任务和私人客户端状态携带对应代际。
- `writeFence`：每次受保护事务实际更新的单调提交版本。不是只读前置检查，不是客户端传来的权限证据。
- `restrictions`：按 `communityWrite/messageSend/profileWrite` 记录当前有效处罚引用、范围、起止时间及版本；处罚与 verified 分离。解除只撤销指定决定，不覆盖之后的其他有效处罚。

全部派生键同步迁为 accountId／epoch 作用域：普通会话、匿名来源通道、会话目录、消息幂等、帖子／评论／草稿创建幂等、资料任务和设备恢复键均不再直接用 OPENID 推导。只更换 publicUserId 而继续使用旧 OPENID 所有权和请求键不算完成。旧分享链接可定位允许读取的资源，不能向同微信新代际授予旧资源所有权；旧 conversationId 可以作为历史引用保留，但绝不根据相同 OPENID 重新生成并授权新账号。

墓碑去掉OPENID明文、邮箱、昵称等业务资料，保留防自动重建及必要历史请求定位的最小假名化字段，按政策2.4的最小关闭标记期限到期清除。HMAC和历史accountId仍可能属于个人信息，不声称匿名或无限期必要。即使标记到期已不存在，ensure也不能根据客户端旧同意创建新账号，必须重新取得明确初始化确认，因此到期不意味着自动复活。

### 3.2 首次告知、ensure 和同意契约

首屏先展示精简隐私告知。未有有效处理依据的新访问者，`users.ensure` 只在本次请求中取得可信微信上下文并判断是否有既有状态，不持久创建 users、行为画像或非必要统计。返回判别结果：

| ensure 状态 | 最小返回及客户端动作 |
|---|---|
| `identityUnavailable` | 可重试错误；保持公开浏览，不伪造账号 |
| `uninitialized` | 当前告知版本及可公开浏览能力；无 accountId、无虚构游客账号 |
| `recognizedNeedsConsent` | 既有账号已被可信识别，但需要当前目的授权；不倒填同意，不额外拉取邮箱／私信等资料 |
| `active` | 在相应授权有效时返回经过显式映射的本人资料和能力；已有认证保持 |
| `closing`／`closed` | 仅本人注销状态／请求进度与适用权利入口；不重新创建账号 |

`users.beginConsent` 是runtime权限的只读动作，返回当前告知版本、目的、可选择项及短期签名挑战。挑战绑定可信微信上下文内部摘要、当时lifecycle状态／epoch（或明确尚不存在）、文档版本、有效期和随机nonce；不在同意前为此建立画像。接受时核验当前状态，旧挑战不得在closing／closed后再次初始化；同一已完成操作只返回原回执。签名秘密不进入客户端。

`users.acceptPrivacyConsent`只接受明确选择的目的、告知版本及有效挑战；不能用缺省true、关闭弹窗或继续浏览代表同意。首次确认同时提供最小年龄分组选择，不采生日；已知under14不建立互动账号，走保护和联系路径。其余有效选择在事务内记录授权，并在未初始化时自动完成同一微信账号初始化。既有账号补选不改原认证，只记录本次实际接受事实；unknown适用保护模式。拒绝／关闭保留公开浏览，同一显示周期不循环弹窗。隐私撤回与协议接受分别处理。

`users.acceptAgreement` 单独记录用户主动接受的服务协议与社区规则版本；它是社交写资格，不是第二次登录。没有旧版本记录时不得按注册时间倒填。当前有效条款版本、隐私目的授权与法定／其他合法依据登记须可区分；同意服务协议不能替代特定个人信息处理需要的授权。

记录包含确切文档版本、全文摘要、服务器时间、epoch、选择目的和来源；用户不能自填发生时间。lifecycle 中只保存这些当前有效记录的引用／版本投影，与接受、撤回和epoch变更同一事务更新，避免最终写许可读取到两份不同的当前状态。首次公开发言或扩大公开身份范围还需相应公开展示告知与明确确认；邮件境外处理授权独立于社区条款，拒绝时不发新验证邮件而保留已有认证。

首次瞬时可信识别、必要安全日志等处理的法律依据和告知时机仍属上线前待审事项。不得虚构“履行合同所必需”等结论。`traceUser`、私人附加读取和非必要统计按具体目的门槛延后；产品文案和实际 SDK 初始化时序必须一致。

### 3.3 提交时的当前许可

所有社交写入（帖子／评论发布、资料修改、私信发送）在最终事务内通过 identity 窄接口检查：当前 accountId/epoch、active、当前协议接受版本、相关目的授权、年龄／保护能力和当前 restrictions，并实际更新 writeFence。入口 Principal 只负责静态动作资格，不能替代提交时可撤销能力。

注销和封禁写同一 lifecycle 文档；发送还按稳定内部标识顺序取得双方生命周期和 messaging 发送屏障。若封禁／closing 先提交，旧请求必须发生冲突、重读并拒绝；若业务先提交，它属于先前已完成操作，不宣称可撤回已经送达的邮件或已被他人阅读的内容。写许可故障返回可重试不可用，不能按无处罚放行。

需要受理的申诉、举报、权利请求、退出及本人内容删除不被“没有当前社交协议”“未认证”“被禁言”整体封死。拒绝协议后的必要资料更正走隐私请求，普通公开昵称修改才适用当前社交协议门槛。权利动作仍核验本人和资源归属；关闭期间由注销流程决定可读范围，不能重启普通社交写入。

## 4. action、DTO 与错误边界

下表是首版目标 action 清单。实现时每项须同时进入 contracts、唯一 action policy、独立产物与行为测试。管理资格为可信已认证账号及明确授予的治理权限；第一位管理员通过可审计的受控账号绑定配置建立，不根据昵称、平台管理员显示名或开发者身份自动赋权。

| 函数／动作 | 权限 | 主要请求与返回 |
|---|---|---|
| users.ensure / beginConsent | runtime | 无客户端身份；返回上节判别 DTO／短期挑战 |
| users.acceptPrivacyConsent | runtime＋挑战 | purpose/version/choice；真实授权回执及初始化结果 |
| users.acceptAgreement | account | documentVersions/requestId；实际 acceptedAt/version 回执 |
| users.withdrawConsent | account，closing 时只允许适用的权利范围 | purpose/requestId/expectedVersion；撤回结果与受影响能力 |
| users.prepareClosure / confirmClosure | 本人可信身份，允许被限制账号 | 短期本人确认挑战；confirm 携 requestId、epoch 和说明版本，返回 privacyRequestId/status |
| users.getPrivacyRequest / listMyPrivacyRequests | 本人或已关闭身份的受限本人路径 | 只看本人处理范围、进度、保留说明、拒绝理由 |
| users.requestDataCopy / readDataCopyPage | 本人，按状态和有效范围授权 | 模块范围／稳定游标；有界结构化本人数据副本，不生成公开下载地址 |
| users.requestCorrection / requestErasure | 本人 | 明确字段／对象和理由；返回隐私请求回执，不直接接受任意数据库 patch |
| users.listPrivacyReview / getPrivacyReview / decidePrivacyRequest | verified＋明确privacyReview权限 | 经identity公开接口取得必要请求及作出有审计决定；无任意身份／数据导出权限 |
| users.rejoin | closed 且明确重新加入挑战 | 同意当前必要授权和条款；新 accountId/publicUserId，默认未认证／普通角色 |
| governance.submitReport | account，不强制学校认证 | requestId、TargetRef、reasonCode、最多1000字说明；reportId/status |
| governance.listMyCases / getMyCase | 本人 | 本人受理状态、公开处置说明；无举报对象真实匿名身份或内部证据 |
| governance.submitAppeal | 决定的受影响本人 | decisionId/requestId/说明；新 appeal case，不覆盖原案 |
| governance.addCaseStatement | 本案提交者／受影响本人，按案件角色限制 | requestId/expectedCaseVersion/说明；追加材料，不改服务端原证据 |
| governance.listReviewQueue / getCaseForReview | verified＋governanceReview | 绑定筛选游标；最小证据、被审版本、规则及审计时间线 |
| governance.decideCase | verified＋governanceDecide | requestId/expectedCaseVersion/判别决定；原子处置回执 |
| governance.listAuditForCase | 案件所需管理权限 | 有界案件相关审计；不是跨站身份／私信搜索 |
| governance.drainGovernanceOutbox | 可信 timer；受限运维重试另有策略 | 仅案件结果投递，不包含后台自动发布任务 |
| messages.setPrivacyPreferences | 本人，允许暂停收信和保护操作 | receiveMode/expectedVersion/requestId；当前设置 |
| messages.blockContact / unblockContact / listBlockedContacts | 本人会话／合法实名上下文 | contextRef 或本人 opaque blockId；受限展示回执，禁止传真实匿名 peer |

用户举报 TargetRef 为判别联合：公开帖子／评论 ID，或 `{conversationId,messageIds}`。私信最多选择10条本人可访问消息，全部属于同一会话；提交前预览实际提供给审核者的内容，需要上下文时由用户显式选择，不能自动抓整段聊天。公开目标已不可见时不得把新举报变成未公开正文读取接口；源已失效的投诉可按“来源当前不可用”受理说明，说明文字标记为用户陈述，不能伪造服务端证据。

`decideCase` 的决定类型限 `dismiss/removeContent/restrictAccount/reverseDecision`，分别定义所需targetVersion或原decisionId；没有预审批准按钮。不提供任意角色修改、集合名、条件表达式或字段patch。案件管理DTO默认只显示案件内别名，不含OPENID、学校邮箱、匿名身份映射。管理者不因角色而常规获得其他用户完整私信／草稿。工作台隐私请求栏调用users的独立隐私审查接口，governance不通过通用查询器接管identity数据。

`posts.create/update`、`comments.create`、`users.updateProfile` 的成功回执表示当前请求已实际提交，返回requestId、resourceId、revision和结果；安全检查未通过／不可用返回明确未提交，不返回待人工发布状态。每个所有者提供 `getSubmissionResult`，仅本人可用原requestId核对结果不确定的提交；重试仍走原写动作，不建新的待发布接口。`messages.send` 保留稳定消息键和明确sent／duplicate回执。学校邮箱和原资料动作同时接入当前授权／保护状态，不只保护第7个新函数。

所有输入时间由服务端生成或严格ISO校验；ID最长128，requestId格式统一遵循contracts；页默认20、最大50。未知或越权字段拒绝。错误至少区分 `INVALID_INPUT/AUTH_REQUIRED/CONSENT_REQUIRED/AGREEMENT_REQUIRED/ACCOUNT_CLOSING/ACCOUNT_CLOSED/WRITE_RESTRICTED/CONFLICT/NOT_FOUND/CONTENT_NOT_ACCEPTED/MODERATION_UNAVAILABLE/RESULT_UNCONFIRMED/RATE_LIMITED/RATE_LIMIT_UNAVAILABLE/PROTOCOL_UNSUPPORTED`；私信关系拒绝统一为不可送达类别，内部脱敏原因另记。与现有公开错误契约合并，不平行建立第二套envelope。

## 5. 当前请求内的自动检查与提交

### 5.1 不可变请求快照和提交屏障

点击提交时冻结规范化标题、正文、匿名选择、分类等负载及expectedRevision，生成固定requestId和contentHash。整个调用使用这一内存快照，不在安全检查途中读取用户继续编辑后的内容。只持久保存必要幂等回执、检查元数据及短期操作lease/generation；不保存完整待审候选、不建立activeCandidate指针或后台待发布队列。

- 新帖子／评论：自动检查完整通过后直接在当前请求事务内创建published内容、计数和事件；未通过时不建公开资源。
- 编辑：旧正文始终保留，检查通过且expectedRevision仍匹配才原子替换；失败、删除／下架或冲突不改变旧公开版本。不能用新修改的pass自动恢复此前被下架内容。
- 昵称：检查通过才更新资料版本并发投影事件，失败保持旧昵称。头像首版仅可信固定资源，不接受任意外链；未来新增上传另补媒体安全链路。
- 同一逻辑提交固定requestId和负载摘要；相同key不同负载冲突。修改后重新提交使用新key；结果不确定时先确认原操作，不把重试当新建。
- 每次实际尝试先取得有界lease和递增generation；最后事务同时检查操作generation未被后继替换、lease未过期、contentHash／检查策略一致、expectedRevision、sourceEpoch、当前许可及资源状态。任何不匹配均不提交。

同一UnitOfWork原子提交资源、幂等回执、计数／同步事件和通知outbox。安全适配器只能返回结论，不能在回调或定时器中发布。主动失败或超过服务端操作时限后，迟到检查结果丢弃，不在用户离开后等待管理员／后台恢复来发布。

网络超时仍可能发生在服务器已提交而回执丢失之后；不能谎称客户端超时必定未写入。此时返回／显示结果未确认，用户用原requestId查询或主动重试取得原回执；不会创建一个“审核后自动发出”的长期任务。只有确认未提交后才允许解锁负载编辑，避免同key内容变化。

### 5.2 文本检测计划

当前官方文本接口是同步响应的 `cloud.openapi.security.msgSecCheck` version 2；字段、时效、配额与作用场景必须按[官方接口文档](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html)在接入时复核。本次核验：content 上限2500，openid需近期访问当前AppID；未上架调用额度较小。scene 1资料、2评论、3论坛、4社交日志；将私信映射到哪个允许场景必须取得平台依据，不能把 scene 4 写成官方“私信专用”。

每个实际调用该API的函数 `config.json` 都声明 `permissions.openapi: ["security.msgSecCheck"]`；构建校验与独立上传包一致，并记录权限变更约10分钟缓存影响。没有声明时的权限错误不能当作审核通过。适配器依据实际SDK返回解析 `errcode/trace_id/result`，HTTP或云调用成功不等于业务pass。[微信云调用权限](https://developers.weixin.qq.com/doc/oplatform/developers/dev/cloudCall)

原帖子正文上限10000、标题200、评论2000、昵称30、私信5000是当前检查点，实施前以最新统一契约常量复核；不因单次检测限制静默降低。

为长正文生成固定分段计划：每段包括必要标题／上下文，总长不超供应商限制；连续覆盖正文，边界保留约200字符上下文；按保守长度预算且不拆Unicode surrogate。保存摘要、分段位置／摘要／覆盖校验、策略版本和各段结果，不另存待发布全文。任何缺段、摘要不符、未知响应或失败均不通过。长文所有段pass后直接进入最终事务，不转人工整篇复核。重叠检测不能等同完整上下文理解，记录剩余识别局限，以事后举报处置补充，不引入第二审核商或AI。

所有文本有效结果均pass才允许提交；review或risky均阻止这一次提交并让用户修改后重提，不转人工待发布队列；异常、超时、配额不足为unavailable，保留草稿／输入稍后主动重试，不能以固定词表兜底放行。误判可作为个案投诉处理，但处理结果不自动恢复这次未提交正文，不提供“管理员批准发布”按钮。

所有外部检测在数据库事务外进行，只在当前请求时限内有限重试，无审核异步worker。平台不保证调用幂等时，响应未知后的重试可能再次耗费额度：operationKey只防重复业务提交，不伪称外部只调用一次。必须使用真正提交者且符合平台时效的OPENID，不换成管理员或其他活跃用户。真实函数timeout、网络预算和首发配额须平台读回验证；当前posts/messages 3秒不能推断足够。分段并发有小上限、总尝试次数和绝对截止时间，不因长文无限延长或突破配额。

首版实施参数先采用：每段调用最多6秒、分段并发2、当前提交总预算20秒、操作租约25秒、相关同步函数超时30秒；每段一次尝试，不在失败请求内自动重试。它们是项目初始参数而非微信SLA，G3测量后可在同一语义下调整并记录。全部并发请求都受同一绝对截止时间约束，不能靠重开计时器延长。未上架账号每天100次只供小批真实测试，应用预算每个实际分段都扣，不按“一篇帖子”算一次；官方近两小时访问要求与配额均在错误解析中明确处理。

文本接口没有异步回调，不为它创建虚假 callback。未来接入异步媒体检测才需要独立可信事件校验、traceId与资源摘要绑定、重放防护、版本复验；未启用媒体功能时不建设空流程。

### 5.3 私信检测

仅检测此次用户主动发送的消息，不向第三方扩展发送历史聊天。超过单次限制使用完整分段计划，全部有效 pass 才进入原消息发送事务；多段语义能力的剩余限制在上线评估中明确。review/risky/故障都不送达，客户端保留输入并提示重试／调整；不建立未来可能突然送达的长期人工队列。

私信检测记录不长期保存待发送明文，仅保留必要操作摘要、结论、策略和短期幂等信息；检测供应商实际处理范围须纳入隐私告知。通过检测不等于最终获准发送，发送事务还须检查双方 lifecycle、当前屏蔽／接收设置及请求幂等。

## 6. 案件、决定、证据与申诉

案件kind为 `report/appeal`，状态为 `open/reviewing/resolved`。自动内容检查不会创建人工预审案件。处理领取不是权限凭据；首版用caseVersion避免并发覆盖，不为一个管理员建复杂派单系统。未来领取租约到期只释放占用，不能自动判案。

每份证据由来源模块在授权后采集，记录来源版本、摘要、采集时刻及必要片段。公开内容、举报者陈述、用户主动提交的私信证据分别标记可信程度。证据访问本身有案件内审计；证据副本不能作为普通页面绕过删除／下架的入口。

每个决定是不可变记录。`requestId`按管理员accountId＋epoch＋action＋requestId确定幂等键并绑定负载。最终事务检查管理员当前资格和lifecycle、caseVersion、资源当前版本，提交决定、实际效果、审计和结果事件；中途失败全部回滚。重试返回原回执，不重复处罚、扣计数或通知。

申诉建立引用decisionId的新案件，原决定和理由仍可追溯。同一本人对同一决定仅一个未结申诉；父案件保存activeAppealId，在创建／结束申诉事务内更新，重复请求复用已有未结案。结案后有新事实才能再申请。撤销处置只撤销该决定的效果；用户自行删除、更新版本或之后的新处罚不被复活。恢复既有下架内容也要重新满足当前状态和自动检查条件，不把“申诉通过”变成对任何新内容的预审批准。

举报人只见受理及不泄露他人隐私的处理说明；被处置者见被影响的本人内容／能力、适用规则、期限和申诉入口。二者都不见另一方真实资料、内部风控细节或匿名映射。未认证举报者通过 governance 本人记录查看反馈，不依赖现有只向已认证用户开放的普通通知页。

合法争议保留逐案指定范围、依据、目的、授权访问者、保留截止／复审时间。它只能冻结必要证据，不能因一条投诉冻结全部账号数据。依法身份请求通过单独受控运营程序处理；首版没有任意揭露匿名身份的 action 或界面。

## 7. 私信防骚扰与同步

已明确选择普通模式的成年账号默认正常接收；首版保护模式默认开启，`ageBand=under14/14to17/unknown` 暂停接收新私信，未确认年龄的已有账号也不能自动标成人。自述adult只代表用户选择，不标作真实年龄认证。只记录分组、选择时间和来源，不收集精确生日／身份证；学校邮箱不能证明成年。已知under14还停止账号互动和新验证邮件，转必要保护及监护人联系／删除流程，不默默开放儿童社交。用户暂停接收同时停止主动发送，恢复前明确提示；该状态由服务端执行，不能改客户端布尔值绕过。

屏蔽对象由本人有效会话或合法实名上下文在服务端解析。对同一真实账户对的所有普通／匿名来源阻断新消息，防止换来源继续骚扰。客户端保存与展示 opaque blockId 和操作时上下文别名；匿名对象不返回公开 userId、内部账户对键、其他关联会话或跨来源统计。

同微信重新加入时，identity只通过受限HMAC关联向messaging提供“仍有有效拒收约束”的窄判断；重新加入不能立即绕过有效处罚或他人屏蔽，且不恢复旧会话、本人旧偏好或认证。屏蔽发起者注销即清其主动关系；其他人的有效屏蔽只保留必要假名目标和有效期，注销目标关联最多遵循政策2.4规定的12个月，到期清除。持续严重制裁另案复审，不能秘密无限留存；不保证不同微信或留存到期后仍可识别。

不提供按任意匿名来源查询“是否已拉黑同一个人”的接口。匿名屏蔽列表不自动合并同人的多来源条目；重复操作只确认此上下文的保护已生效。发送者只收到通用不可送达原因。账户级屏蔽仍可能通过多个会话的送达行为产生有限关联推测；可避免披露真实身份和稳定关联标识，不能承诺行为绝对不可关联。

发送、屏蔽、解除及拒收设置共享 messaging 版本化屏障；操作按稳定内部ID顺序读取并更新。缺失文档、首次发送与首次屏蔽竞争也必须确定性建键。解除保留版本化 tombstone，不删除屏障使迟到请求误判成从未屏蔽。屏蔽／暂停不删历史、不中断本人举报和申诉能力。

发送屏障键可用受限lifecycle关联派生以执行尚有效的拒收，和以新accountId／epoch派生的会话、消息、业务幂等键严格分开。保留关联到期时清除相关拒收约束／映射及不再必要的屏障；不能因保存一个pairKey而暗中延长关联。屏蔽状态无效或过期时依当前明确策略计算，不从不存在关系推断匿名身份。

删除、下架和注销不仅影响下一次历史读取，还须使已打开的会话及时撤回旧正文。现有按消息创建序号增量查询不能自动传播旧消息的脱敏修改；实施应增加 messaging 拥有的 `conversation_changes`，以同一会话单调序号记录 `messageCreated/messageRedacted/participantClosed` 等变更。消息历史顺序保留原发送序号，不能通过改原消息排序字段制造乱序。同步协议升级并绑定明确水位，过期游标返回重新同步信号；客户端收到删除事件清除旧内容缓存而保留无正文占位。

## 8. 目标 schema 与索引

下表为必须进入版本化schema manifest的设计，不是已创建集合。所有新增集合客户端权限为admin-only；公开法律文本经静态构建／受控公开接口读取，不开放私有文档查询。目标内部字段为camelCase；可由唯一适配器映射确定的数据库字段名，但不得运行新旧协议别名或新旧字段双写。新时间字段为UTC ISO，排序字段必须同类型。

| 集合／所有者 | 关键字段与约束 | 查询索引／确定性键 |
|---|---|---|
| account_lifecycle／identity | lifecycleId、currentAccountId、state、epoch、writeFence、restrictions、ageBand/protection、当前assent／purposeGrant引用、updatedAt、closedAt、retentionPolicyRef；安全整数与状态联合验证 | `_id=HMAC(keyVersion,AppID,OPENID)`；currentAccountId唯一（稀疏约束需平台验证）；state/updatedAt/_id |
| users／identity，扩展 | 保留既有文档ID和认证；accountId、publicUserId、lifecycleId、已发布资料版本；不公开绑定字段 | accountId唯一、publicUserId唯一；保留当前可信微信唯一性直到迁移核对完成 |
| consent_records／identity | accountId或同意时分配的新accountId、epoch、purpose、documentVersion、choice、occurredAt、operationId；追加记录，不倒填 | accountId/purpose/occurredAt/_id；operationId/purpose唯一，允许一次操作记录多个目的 |
| agreement_assents／identity | accountId、epoch、documentKey/version、acceptedAt、operationId；当前有效版本可重建／一致投影 | accountId/documentKey/acceptedAt/_id；operationId/documentKey唯一，允许一次操作接受多份文档 |
| privacy_requests／identity | requestId、ownerAccountId、lifecycleId、epoch、kind、status、step/checkpoints、lease/attempt、retainedScopes、policyVersions、createdAt/updatedAt | ownerAccountId/createdAt/_id；status/nextAttemptAt；status/leaseUntil；幂等键确定性 |
| submission_operations／对应业务所有者经受限基础设施port | ownerAccountId/epoch、module/action/requestId、contentHash、expectedRevision、generation、leaseUntil、status、policyVersion、段摘要和检查结论、providerTraceIds、最小提交receipt；不存待发布正文 | `_id=module/action/accountId/epoch/requestId确定性键`；ownerAccountId/_id；expiresAt/_id；无worker扫描发布索引 |
| governance_cases／governance | caseId、kind、reporterAccountId/affectedAccountId（仅内部）、targetRef、caseVersion、status、reasonCode、evidenceIds、relatedDecisionId、activeAppealId、resolution、createdAt/updatedAt | reporterAccountId/createdAt/_id；affectedAccountId/createdAt/_id；status/kind/createdAt/_id；targetType/targetId/createdAt/_id |
| governance_evidence／governance | caseId、sourceRef/version/hash、capturedAt、evidenceKind、最小payload、retentionPolicyRef、holdRef、expiresAt | caseId/capturedAt/_id；sourceAccountId/_id；expiresAt/_id |
| governance_actions／governance | caseId、actionId、operationKey、actorAccountId、actorEpoch、type、reason、resourceVersion、effectRef、createdAt；追加审计 | operationKey唯一；caseId/createdAt/_id；actorAccountId/createdAt/_id |
| governance_outbox／governance | eventId、caseId/decisionId、recipientAccountId/epoch、payloadRef、status、attempt、leaseUntil、nextAttemptAt、createdAt | eventId确定性；status/nextAttemptAt/_id；status/leaseUntil；recipientAccountId/_id |
| messaging_preferences／messaging | ownerAccountId、receiveMode、version、writeFence、updatedAt；缺省由保护策略确定 | ownerAccountId唯一 |
| messaging_blocks／messaging | 内部pairKey、有效发起方accountId、必要目标HMAC关联、各方向blocked/version、writeFence、subjectLinkExpiresAt、updatedAt；解除留有期tombstone | `_id=受限lifecycle对确定性屏障键`；两侧归属索引供清理；subjectLinkExpiresAt/_id；对外不返回pairKey或目标关联 |
| conversation_changes／messaging | conversationId、sequence、kind、messageId、messageRevision、最小变更payload、createdAt；无多余身份副本 | conversationId/sequence唯一；conversationId/createdAt；清理与游标保留边界一致 |

submission_operations的每条记录由module/action对应的业务模块唯一写入，隔离的port只能访问该模块及当前主体作用域；不得变成任意业务表的万能接口。检查元数据并入这一必要幂等记录，不另建审核任务表、完整候选表或候选指针。posts/comments保留当前公开正文、revision与状态；accountId、事件epoch、清理字段须进入相应既有集合和索引。

不得用 TTL 无条件删除有合法保全的证据或仍在允许重试窗口内的幂等记录。清理条件、保留窗口、游标过期行为和索引数量以实际平台能力核验；索引唯一冲突先出报告，不能删用户记录来使迁移通过。

幂等窗口具体化：提交回执最多90日，与本地恢复的最长窗口对齐；清理后不能让旧请求变成一次新提交。新协议requestId采用带生成时间的UUIDv7或同等可验证格式；既存操作先查回执，未见过的key仅接受24小时内生成且不明显超前的时间（时钟超前容差5分钟）。超过窗口的未确认key返回明确已过期，不能自动换key重发；先查询对应资源／向用户说明结果。时间只是限制旧key重放的协议字段，不充当授权；资源存续期间的唯一创建指纹保留并可核对。离线草稿正文仍可恢复90日，恢复正文后由用户主动产生新提交，不自动重放过期操作。

政策中的30日增量变更期限只适用于comment_changes、conversation_changes等独立变更记录，不能给兼作聊天历史的messages套同一TTL。正常消息正文按正常私信保留规则处理；变更过期后通过有界历史重同步恢复当前状态，不恢复已删正文。

## 9. 工作者、观测与人工运行

不设审核／发布worker。只有既有资料／通知补偿、governance结果outbox和privacy_requests清理任务需要后台有界取页；它们使用现有lease/attempt隔离迟到完成，pending/processing/done/stale/failed状态与失败退避明确。后台补偿不能调用任何内容发布入口；过期操作只能清理必要元数据，不能恢复正文后再发。

timer 只接受平台可信来源。运维重试入口与普通客户端、管理复核入口分别授权；不能增加临时维护后门。停止一个任务不影响其他案件；失败最终保留明确原因类别和处理入口，不能输出供应商原始响应或私信正文。

资料投影任务在开始及最终写入时校验sourceEpoch、active和版本；outbox在投递前验证收件人当前生命周期和来源内容可见性。通知最小payload优先引用来源，不永久复制原文；旧通知的存储副本须按保留／删除规则清理。当前并行技术修复已补通知读取的来源可见性过滤，实施时复用，不把旧审计中的必定展示失效摘要当作现状。治理结果走本人专用路径，不因普通通知权限被拒而失联。

观测记录requestId/action/版本/耗时/结果码、待处理举报／申诉年龄、检测调用额度、最老补偿事件年龄和隐私任务检查点，不建人工待审吞吐指标。日志只允许字段，禁止完整event、账号记录、邮箱、验证码、正文、匿名映射。明确告警接收者和处理渠道；无人接收的配置不算运行准备完成。

人工可完成个案判断、理由说明、合法保全、外部平台确认和真实首位管理员绑定；人工不能替代缺失的服务端鉴权、案件受理、审计、反馈及定时补偿。不自动生成“微信已批准”“已处置”“已注销全部数据”等虚假证据。

## 10. 数据副本、注销与恢复

### 10.1 本人副本与请求处理

首版以本人鉴权后的有界分页预览和可复制结构化文本提供副本，不新增文件上传、临时下载链接或另一套私有存储。游标绑定accountId/epoch/group及查询范围，每页重新核验。固定截至水位和各模块稳定ID／时间边界，记录查询时刻、已返回数、下一游标和本组是否完成；非快照分页明确期间变化结果与可重取窗口，不将第一页标为完整副本。大量／复杂副本进入有进度的人工协助。只提供本人有权数据，剔除对端身份、他人邮箱、举报人、管理证据；匿名对端内部假名化稳定标识也不输出。注销立即使普通副本游标失效，后续诉求走受限本人权利路径；副本完成不是注销前提，不泄漏给新代际账号。

更正、删除、撤回和注销请求都由 identity 记录；受理、补充、执行、完成／受限保留、拒绝分别返回明确状态。拒绝有原因及申诉入口；不能仅把无人接收的邮箱作为完整机制。

### 10.2 注销事务和写入隔离

prepareClosure 生成短期本人挑战，绑定 lifecycleId/accountId/epoch、注销说明版本与有效期；confirmClosure 要用户明确操作。无默认强制冷静期。最终提交同一事务消费挑战、校验幂等负载、state=closing、epoch递增、writeFence更新，并建立 privacy_requests 删除任务。进入不可逆清理后不能自动取消并恢复旧个人资料。

closing 起所有普通数据写、邮箱验证完成回调、已发布资料投影与其他迟到队列都不能越过当前epoch。验证码立即失效；已发出的邮件可能迟到，不能从收件箱撤回，但旧挑战不能认证或回写。学校邮箱归属最终释放需与关闭阶段状态事务协调，新账号争抢绑定不能拿到旧挑战资格。

每个模块提供 `plan/eraseBatch/verifyResiduals` 等语义窄能力，workflows 按模块执行；不建任意集合删除器或万能任务引擎。任务按稳定ID游标有界分批，删除不能使用会移位的offset；保存检查点、认领次数和本次代际，重复执行无额外副作用。最终残留核验完成才设置业务closed，并分别记录依法受限保留项。

### 10.3 现有18集合的清理责任

| 现有集合 | 所有者 | 关闭处理与验收 |
|---|---|---|
| users | identity | 去除业务资料与身份明文；保留最小生命周期墓碑，不继续通过旧author查询恢复个人资料 |
| email_verifications | identity | closing即时失效，随后删除；旧发送／确认回调不得重建 |
| email_send_limits | identity | 删除归属数据；必要反滥用例外另行最小化说明 |
| email_claims | identity | 在关闭阶段的受控身份事务中释放；校验当前拥有者，不能删其他账号后来取得的claim |
| posts | content | 本人正文／标题／作者快照撤下并删除；必要无身份占位承载他人结构，操作元数据按策略清理 |
| categories | content | 分类本身保留；可见帖子计数随实际状态幂等更新，不按账号删除分类 |
| drafts | content | 本人的所有草稿与服务器恢复数据删除 |
| draft_counters | content | 清理本人计数，防迟到草稿重建 |
| comments | comments | 本人正文和身份删除；他人回复保留结构所需的无正文／无身份占位 |
| comment_counters | comments | 随剩余结构及同步水位维护，不为清理重置成可覆盖旧事件的序号 |
| comment_changes | comments | 先产生并保留必要删除事件，最终按同步保留策略到期；旧游标明确重新同步 |
| messages | messaging | 产品默认：本人发出正文两侧变删除占位，他人独立发出的正文按其权利和政策保留；不是统一法律结论；去除不再必要的真实身份／匿名映射 |
| conversation_entries | messaging | 删除注销者目录；对方目录标记对端已注销、清身份与已删摘要；不可发送但保留允许历史 |
| conversation_counters | messaging | 仍需同步时保留；双方数据均可清除后再删除，不能导致序号复用 |
| notifications | notifications | 给注销者的通知删除；其他人的通知去该人身份和已撤正文／标题副本 |
| notification_outbox | notifications | 取消会重建已删除通知／内容的事件并清副本；迟到消费者按epoch拒绝 |
| profile_outbox | identity编排、各模块投影 | 取消旧代际投影，防止在清理后把作者资料写回 |
| rate_limits | 对应用途所有者／基础设施 | 删除不再必要的原身份记录；依法有依据的反滥用保留独立限制范围和期限 |

新集合也纳入清理：提交幂等和检查元数据由各所有者删除／到期，屏蔽与偏好按双方权益去身份，cases/evidence/actions按具体保全范围最小保留，outbox取消，授权／隐私请求只保留经确认必要的证据。不能只完成上表而忽略新建数据。

消息去身份不能把双方from/to改为同一个全局 `deleted` 字符串。保留会话作用域内不可跨会话关联的closed成员占位，剩余合法成员继续只读；历史、同步和DTO显式接受closed成员与无正文删除消息，保证计数和序列有效。正常接口移除旧真实映射，受限依法留存另归隔离证据；新账号即使属于同一微信也不能通过旧会话ID取得成员权。

### 10.4 新代际、设备与备份

closed后ensure仅返回关闭状态。明确rejoin才创建全新账号和公开ID，默认未认证／普通角色，不认领旧内容、邮箱挑战、会话、本人收信偏好、草稿、幂等键或本地队列。在政策允许的有效保留期内，未到期处罚和他人的有效屏蔽通过受限HMAC关联继续执行；不是恢复旧业务账号，且到期必须清除关联／复审，不无限期秘密留存。

迁移和批量清理保护既有认证及指定账号；保护对象按确认后的内部ID和可信绑定核验，不按昵称／前缀白名单。将来本人明确请求注销须正常处理，迁移保护名单不能永久剥夺其注销权。旧AppID／旧环境单独确认归属与保留，不按本次新账户自动跨环境删除。

客户端收到closing，先递增账户代际、停止所有轮询／自动保存／已读及清理队列，再清该accountId资料、草稿恢复、搜索和请求键。存储删除失败不允许恢复旧会话，下次联网再次清理；不能承诺立即远程擦除离线设备。重新加入的缓存命名空间与旧accountId完全分离。

备份采用明确生命周期；删除台账最小化、受限且可独立恢复。恢复注销前备份时必须先在隔离环境重放关闭、去身份和摘要清理，再开放服务；代码回滚也不能恢复无关闭屏障的旧写入口。closed表示业务注销完成，不表示所有备份、依法保全记录已即时物理消失。报告分别列删除项、受限留存项、到期／复审时间和恢复覆盖范围。

## 11. 迁移与退出顺序

1. 冻结本次配套协议、规则、schema及测试夹具；确认真实管理员、保留对象、数据处理依据、检测场景／配额和恢复条件。未确认法律字段标记待审，不能补假值。
2. 从真实当前状态建立只读盘点，验证可恢复备份；以最终源码快照及锁构建全部7函数，补独立产物测试和新入口默认拒绝。发布单元记录schema/策略/文本/代码/函数摘要。
3. 在隔离环境建立新增私有集合和索引；建立 lifecycle、accountId/publicUserId 映射，保留原文档ID、认证和微信关联，核对唯一性、数量及指定账户。历史同意记录保持缺失，不按迁移时间伪造同意。
4. 既有内容原正文／状态保持，不为历史数据新造候选或伪造检测通过；必要版本、所有者和摘要经受控迁移补齐。自动检查自新协议写入开始强制，旧下架内容不自动恢复。
5. 对消息、通知、outbox及清理查询回填accountId/epoch／同步水位。新匿名通道仍按来源隔离；不把同人多来源合并。验证新同步协议完整交接及旧缓存失效。
6. 同一新协议直接切换：维护窗口停止旧客户端／旧函数全部写入口和旧补偿消费者，迁移后只部署配套新协议。请求携带明确protocolVersion，旧版本／缺失版本按目标策略拒绝，不能降级调用旧端点。删除旧 `posts.flag` 直接发布动作、compat fallback、旧字段别名及双写；保留账户认证数据不代表保留旧协议兼容。
7. 在隔离环境完成下节G3/G4，发布后读回真实函数runtime/timeout/timer、集合ACL／索引及版本；云上传成功不是配置已对齐。逐函数失败保留版本矩阵，不能报全部成功。
8. 核验旧动作／旧参数无法重新写、旧任务不能越过epoch、新用户首次授权和已认证旧用户均符合契约。离线迁移适配只用于一次性数据转换，切换后退出运行路径；无长期双轨。保留备份按生命周期处理，不因直接切换跳过恢复演练。

恢复必须恢复一致的代码、数据、授权及删除台账；若旧产物不支持新的治理和关闭状态，只能前向修复或在关闭写入后受控恢复，不能直接回退到绕过自动检查／复活账号的旧代码。

## 12. G1–G4 验收定义

以下为待编写／待执行的验收，不是本轮运行结果。测试重点验证可观察权限、响应和副作用，不用新增文件数量或测试数量声称完成。

| 门槛 | 必须取得的证据 |
|---|---|
| G1 静态／构建 | 新业务严格TS；contracts/权限表/真实7入口一致；schema字段／索引／客户端私有权限检查；每函数独立包加载；治理分包无越界依赖；公开包无服务端秘密／证据模型 |
| G2 身份／授权 | 首次拒绝不持久建账号／不trace、不影响浏览；明确同意后单账号初始化；既有认证保留而不倒填同意；旧条款／撤回／closing后社交写拒绝；被禁言仍可举报申诉及权利申请 |
| G2 自动检查／案件 | 全段pass在当前请求直接提交，不等待人工；review/risky／异常均未提交且无后台发布；编辑失败保留旧正文；过期generation／revision冲突／关闭后晚结果失效；管理员并发／同键异负载／中途失败不半处置；申诉不复活后来删除或新处罚 |
| G2 匿名／私信 | 第三人、跨会话messageId、伪造peer拒绝；所有DTO嵌套身份注入仍不泄漏；屏蔽不返回跨来源关联；同微信新代际仍服从有效拒收且过期关联清理；私信只检测本次内容，非pass不送达；unknown／14to17保护模式及under14不建互动账号 |
| G2 并发／补偿 | 社交写与封禁／撤回／注销竞争；发送与拉黑／解除竞争；同一屏障真实更新；timer伪造、过期租约、迟到完成和重复事件不覆盖；删除通知／消息同步不返回旧正文 |
| G2 权利／清理 | 注销挑战重放、双设备旧缓存、同微信重新加入新ID、邮箱释放竞争；超过一页跨18集合及新集合清理；依法局部留存不冻结全部；副本不含对端身份／管理证据；分页失败不推进游标 |
| G3 隔离云端 | 当前AppID可信身份；实际审核场景、额度和真实响应；SDK超时、真实数据库写冲突／回滚、索引／ACL、独立7包、timer调度／失联恢复；注销与真实邮件／投影回调竞争；不能把合成SDK夹具当真实并发证据 |
| G4 设备／运营／恢复 | 安卓／iOS记录版本和renderer；首次告知拒绝／同意、认证旧账号、直接发布／失败编辑恢复、举报到个案处置再申诉、双账号普通／匿名拉黑、保护模式、注销／重新加入；无管理员在线正常发布仍成功；弱网／卸载结果未确认的幂等确认；备份恢复先重放删除；投诉告警有人接收 |

最小工作台只有队列、案件详情和审计时间线；用户端有举报、本人案件／申诉、私信屏蔽与权利入口。界面存在不等于服务端可执行；手工处理过一个案件不等于全部入口和失败路径通过。每切片同步唯一状态表，记录实测、尚未完成的外部确认和旧入口退出条件；本设计不得被标记为治理功能已经实现。
