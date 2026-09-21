# WeChat Mini-Program Frontend Tech Stack — Research Report

## Problem Domain

Select the frontend tech stack for Lucky BBS prototype. Constraints: (1) WeChat
mini-program only — no H5/App needed, (2) prototype phase — all data mocked, no
real backend, (3) fast iteration over ceremony, (4) scaffold already exists as
WeChat native (TypeScript + Skyline + Glass-Easel).

---

## References

### Reference 1: WeChat Native (Skyline + Glass-Easel + TypeScript)
- Source: https://developers.weixin.qq.com/miniprogram/en/dev/framework/runtime/skyline/features.html
- **Architecture pattern**: Native rendering engine (Skyline) + native component framework (Glass-Easel). No framework abstraction layer — WXML/WXSS/TS compile directly to native render calls.
- **Interface design style**: `Component()` constructor with `properties`/`data`/`methods`/`lifetimes`. Chaining API with `init()` for TypeScript-native state. `setData` for reactivity.
- **Extension strategy**: Custom components in `components/`. Pages in `pages/`. Subpackages for bundle splitting. `app.json` for global config. WeChat plugin system for third-party extensions.
- **Error handling**: `wx.request` fail callbacks. `wx.onError` global error listener. `wx.reportEvent` for analytics. Lifecycle-aware cleanup in `detached`.
- **Key trade-offs**:
  - **Decision**: Native WXML/WXSS | **Alternative**: JSX (Taro) or Vue SFC (Uni-app) | **Reason**: Zero abstraction overhead, full access to new WeChat APIs on day one, Skyline render engine exclusive to native
  - **Decision**: WeChat-only | **Alternative**: Cross-platform (Uni-app/Taro) | **Reason**: Project only targets WeChat. Cross-platform code is dead weight.

### Reference 2: Taro 3 (React/Vue → Mini-Program)
- Source: https://cloud.tencent.cn/developer/article/2667283
- **Architecture pattern**: Runtime DOM abstraction layer. React/Vue components → Taro virtual DOM → mini-program `setData` calls. Heavy runtime in the bundle.
- **Interface design style**: React Hooks / Vue Composition API. Standard npm workflow. Webpack/Vite bundling. TSX/SFC component files.
- **Extension strategy**: npm ecosystem. Platform adapters (`@tarojs/platform-weapp`). Custom wrapper for performance-critical paths. NutUI component library.
- **Error handling**: React/Vue error boundaries. Taro-specific platform error normalization.
- **Key trade-offs**:
  - **Decision**: React/Vue developer experience | **Alternative**: Native WXML | **Reason**: Familiar DX, shared logic with web projects | **Cost**: +150-200KB bundle, ~20-30% performance overhead, runtime DOM layer complexity
  - **Decision**: Cross-platform by default | **Alternative**: Single-platform native | **Reason**: Write once, run on WeChat/Alipay/Douyin | **Cost**: Platform quirks require ~20% manual adaptation

### Reference 3: Uni-app (Vue → Mini-Program)
- Source: https://cloud.tencent.cn/developer/article/2667283
- **Architecture pattern**: Compile-time template translation. Vue SFC → native WXML/WXSS/JS. Closer to native output than Taro's runtime approach.
- **Interface design style**: Vue SFC with `<template>`/`<script>`/`<style>`. Condition compilation (`#ifdef MP-WEIXIN`). HBuilderX IDE or VSCode CLI.
- **Extension strategy**: Massive plugin marketplace. UniCloud for serverless backend. Wot UI / uView component libraries. Condition compilation for platform-specific code.
- **Error handling**: Vue error handling patterns. Platform-specific error codes normalized through uni API layer.
- **Key trade-offs**:
  - **Decision**: Compile-time translation | **Alternative**: Runtime DOM (Taro) | **Reason**: Output closer to native, better performance than Taro | **Cost**: +80-120KB bundle, ~10-20% perf gap vs native
  - **Decision**: Vue ecosystem | **Alternative**: React (Taro) or native | **Reason**: Largest WeChat mini-program community, most plugins | **Cost**: Vendor lock-in to DCloud ecosystem, HBuilderX strongly encouraged

---

## Comparison

| Dimension | WeChat Native (current) | Taro 3 | Uni-app |
|-----------|------------------------|--------|---------|
| **Language** | TypeScript + WXML | React/Vue + TSX/SFC | Vue + SFC |
| **Rendering** | Skyline (native) | Virtual DOM → setData | Compile → WXML |
| **Bundle overhead** | 0 (baseline) | +150-200KB | +80-120KB |
| **List performance** | 876ms (baseline) | ~1,050ms | 741ms* |
| **Tap response** | 111ms (baseline) | ~150ms | ~130ms |
| **WeChat API access** | Day 1, all APIs | Lagged (adapter needed) | Lagged (adapter needed) |
| **Multi-platform** | No (WeChat only) | Yes (5+ platforms) | Yes (8+ platforms) |
| **Component library** | WeUI (light) | NutUI | Wot UI / uView |
| **State management** | Chaining API / globalData | Zustand / Jotai / Redux | Pinia / Vuex |
| **TypeScript support** | Good (Chaining API) | Excellent (native TSX) | Good (Vue TS) |
| **Learning curve** | Medium (WeChat-specific) | Low (React devs) / Med (Vue devs) | Low (Vue devs) |

> * Uni-app list performance better than native in the Tencent benchmark is likely due to batched setData optimization — native code can achieve the same with manual optimization.

---

## Trade-off Analysis

**The core question**: switch from the existing WeChat native scaffold to a
cross-platform framework, or stay?

- **Argument for switching**: Better DX (React/Vue), npm ecosystem, component
  libraries, cross-platform "for free".

- **Argument for staying**: (1) The project only targets WeChat — there is no
  requirement for H5, Alipay, Douyin, or App. Cross-platform code is YAGNI.
  (2) The scaffold already exists and is configured (Skyline, Glass-Easel,
  TypeScript, appid). Switching means deleting working code. (3) Prototype with
  mock data needs fast iteration — native has zero build-chain overhead,
  `project.config.json` → open in WeChat DevTools → running. (4) Skyline render
  engine is exclusive to native — cross-platform frameworks use the legacy
  WebView renderer or have incomplete Skyline support.

  (5) Bundle size matters. Native baseline leaves more room for actual
  application code under the 2MB main-package limit.

**Decision**: Stay with WeChat Native. Cross-platform is speculative — the
project roadmap has zero mention of non-WeChat platforms. If H5 or App becomes
a requirement later, evaluate migration then. The cost to rewrite at that point
is comparable to the cost of carrying cross-platform abstractions from day one.

---

## Recommendations

### Tech Stack

```
Language:        TypeScript (strict mode)
Renderer:        Skyline (already configured)
Component:       Glass-Easel (already configured)
UI Base:         WeUI-miniprogram (official, ~50KB)
Styling:         WXSS + CSS variables for theming
State Mgmt:      getApp().globalData for auth/user
                 Component data + setData for page state
                 wx.Storage for local cache (drafts, history)
Build:           WeChat DevTools (zero-config)
Mock Data:       Static JSON files in miniprogram/mock/
                 wx.request intercepted via mock middleware
```

### Why not...

| Tool | Reason skipped |
|------|---------------|
| **Taro** | +150KB bundle, runtime overhead, no multi-platform requirement |
| **Uni-app** | +80KB bundle, vendor lock-in, existing native scaffold already works |
| **MobX / Redux** | Overkill for prototype — globalData + setData sufficient for 10 pages |
| **Vant Weapp** | ~500KB. WeUI covers basic needs. Add individual Vant components only if WeUI falls short |
| **Pinia / Vuex** | Requires Uni-app. Staying native |
| **Zustand / Jotai** | Requires Taro. Staying native |
| **WXS** | Premature optimization. Skyline handles data diffing efficiently |

### Project Structure

```
miniprogram/
├── app.ts              # getApp().globalData: {token, user, isMock}
├── app.json            # pages, window, renderer, subpackages
├── app.wxss            # CSS variables, global styles
├── components/         # Shared components (reel-search, reel-list, post-card, ...)
├── pages/              # Page directories (login, index, search, topics, ...)
├── services/           # Client modules
│   ├── api.ts          # wx.request wrapper, JWT injection, mock interceptor
│   ├── auth.ts         # wx.login → mock JWT, token storage
│   └── storage.ts      # wx.Storage typed wrapper
├── mock/               # Static JSON mock data
│   ├── posts.json
│   ├── categories.json
│   ├── messages.json
│   └── user.json
└── utils/
    └── util.ts
```

### Mock Strategy

All API calls route through `services/api.ts`. In prototype mode (`isMock: true`
in globalData), the `request()` function reads from `mock/*.json` files with a
simulated 200-400ms delay. This allows:
- Full UI development without a backend
- Realistic loading/empty/error states
- Drop-in replacement when backend is ready — flip `isMock` to `false`

---

## Sources

- [Tencent Cloud: Native vs Framework Mini-Program Development Deep Evaluation](https://ecweb.ecer.com/topic/cn/detail-291137-tencent_cloud_explores_native_vs_framework_miniprogram_development.html)
- [Taro vs Uni-app 2026 Practical Selection Guide](https://cloud.tencent.cn/developer/article/2667283)
- [WeChat Skyline Render Engine Features](https://developers.weixin.qq.com/miniprogram/en/dev/framework/runtime/skyline/features.html)
- [Glass-Easel Component Framework Introduction](https://developers.weixin.qq.com/miniprogram/en/dev/framework/custom-component/glass-easel/introduction.html)
- [WeUI-miniprogram — Tencent Official](https://github.com/wechat-miniprogram/weui-miniprogram)
