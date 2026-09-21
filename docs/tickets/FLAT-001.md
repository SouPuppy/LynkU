---
id: FLAT-001
title: "Flat UI: text-only TabBar + logout redesign + remove arrow icons"
status: done
type: feature
priority: medium
autonomy: L3
parent: EPIC-002
dependencies: []
labels: [ui, flat-design, polish]

# == Scope Contract ==
scope:
  - "[x] app.json: remove iconPath/selectedIconPath from all 3 tabBar items"
  - "[x] Delete assets/tabbar/*.png (6 files)"
  - "[ ] profile.wxml: replace <button class='logout-btn'> with flat text row + confirmation"
  - "[ ] profile.wxml: replace <view class='arrow'> with <text class='row-arrow'>></text>"
  - "[ ] profile.wxss: remove .logout-btn styles, remove .arrow styles, add .row-arrow"
out_of_scope:
  - "NavBar component changes (already text-only)"
  - "Login page changes (already clean)"
  - "Color scheme changes"
  - "Font changes"
  - "TabBar order/label changes"

# == Impact ==
affected_modules: [mp-pages/profile, mp-config]
affected_interfaces: []

# == Meta ==
created: 2026-07-21T05:00:00.000000+00:00
updated: 2026-07-21T05:00:00.000000+00:00
created_by: agent-claude

---

## Description

Minimal UI polish pass. Three changes:

1. **TabBar text-only**: Remove PNG icon paths from `app.json` tabBar config.
   WeChat miniprogram natively supports icon-less tabBar — text centers vertically,
   bar becomes shorter.

2. **Logout as flat text row**: Replace the prominent pill button with a simple
   centered text row matching the visual weight of other settings rows. The
   confirmation dialog (`wx.showModal`) already exists in the tap handler.

3. **Remove CSS arrow icons**: Replace `.arrow` CSS triangles with a simple `>`
   Unicode character — cleaner, no custom geometry CSS.

## Before / After

### TabBar
```
Before: 首页  私信  我的
After:  首页  私信  我的           (text-only, shorter bar)
```

### Logout
```
Before: ┌──────────────────────┐
        │      退出登录         │  ← red pill button, stands out
        └──────────────────────┘

After:  ───────────────────────   ← thin separator
           退出登录               ← centered, muted, subtle
```

### Settings rows
```
Before: 微信绑定    已绑定 ▸    (CSS triangle arrow)
After:  微信绑定    已绑定 >     (text character, cleaner)
```

## Evidence


## Resolution (2026-07-23)

实现已落地；`npm run check`（strict typecheck、云函数语法检查、10 项回归测试）通过。
