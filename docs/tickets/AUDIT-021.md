# AUDIT-021: strict TypeScript 检查无法通过且项目未提供 typecheck 脚本

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Problem

`package.json` 没有脚本，也没有 `typescript` 开发依赖。使用临时 TypeScript 5.9.3 执行 `tsc --noEmit` 时退出码为 2，共报告 19 个错误。主要包括：

- 4 个组件将 `Object` 属性默认值设为不兼容的 `null`。
- `search-bar.ts` 使用未声明的 `_debouncedInput`。
- `editor.ts:174` 调用参数类型不匹配的 `_debouncedSave`。
- 两处使用不存在的 `ModalSuccessCallbackResult` 类型。
- `services/cloud.ts` 引用不存在的 `WechatMiniprogram.Cloud` 命名空间。
- 本地 typings 缺少 `getWindowInfo`，并存在泛型约束错误。
- strict 配置下还有未使用导入、变量和参数。

## Recommended Fix

- 固定兼容的 `typescript` 与 `miniprogram-api-typings` 版本。
- 添加可重复执行的 `npm run typecheck`。
- 修复真实类型问题，不通过关闭 `strict`/`noUnused*` 绕过。

## Acceptance Criteria

- 全新安装依赖后 `npm run typecheck` 退出码为 0。
- CI 或提交前检查会执行 typecheck。
- 类型版本与 `project.config.json` 的基础库/API 使用保持一致。


## Resolution (2026-07-23)

`npm run check` 已包含 TypeScript 5.9.3 strict 检查、云函数语法检查和回归测试。
