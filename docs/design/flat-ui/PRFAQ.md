# Flat UI — Text-Only Navigation + Modern Minimal Design

## Problem

The current UI has two visual problems:

1. **TabBar uses PNG icons.** 6 icon files (`assets/tabbar/*.png`) that clash with
   a modern flat aesthetic. The icons are generic placeholders that add visual noise
   without function — users read the text label, not the icon.

2. **Logout button is ugly.** A full-width outlined pill button (`class="logout-btn"`)
   with red text and border-radius: 999px. It's the heaviest element on the profile
   page, visually screaming for attention on an action that's secondary. The settings
   page also uses CSS triangle arrows (`.arrow` class) as pseudo-icons — unnecessary
   decorative elements.

The rest of the app is already close to flat: nav-bar uses text-only "返回", login
page is clean typography, cards use minimal borders. The tabBar icons and the
logout button are the remaining rough edges.

## Solution

Three changes, all in the profile page and app config:

### 1. TabBar: text-only, no icons

Remove `iconPath` and `selectedIconPath` from all three tabBar items. WeChat
miniprogram natively supports text-only tabBar — when you omit icon paths, the
text centers vertically and the bar becomes shorter (more screen for content).

```diff
- "iconPath": "assets/tabbar/home.png",
- "selectedIconPath": "assets/tabbar/home-active.png",
```

### 2. Logout: flat text row

Replace the prominent `<button>` with a simple settings row — same visual weight
as "微信绑定" and "编辑资料". A text label, no border, no pill shape, no red color.
Just a standard row that happens to trigger logout on tap.

Before (heavy):
```
┌──────────────────────────────┐
│          退出登录             │  ← pill button, red text, border
└──────────────────────────────┘
```

After (flat):
```
─────────────────────────────────  ← subtle separator
  退出登录                        ← plain text, centered, same weight as other rows
─────────────────────────────────
```

Actually, even better: make it a standard row with subtle danger styling — not a
button at all:

```
  微信绑定                  已绑定 >
  邮箱认证                  未认证 >
  编辑资料                        >
  ───────────────────────────────
  退出登录                        ← centered text, muted color, no arrow
```

### 3. Remove arrow CSS icons

Replace `.arrow` CSS triangles with simple Unicode `>` character — cleaner, no
custom CSS needed, consistent rendering across devices.

```diff
- <view class="arrow"></view>
+ <text class="row-arrow">></text>
```

With a single line of CSS:
```css
.row-arrow { color: var(--color-text-light); font-size: var(--font-sm); }
```

## Scope

| In | Out |
|----|-----|
| TabBar: remove iconPath/selectedIconPath, text-only | TabBar redesign (colors, order stay) |
| Profile: logout as flat text row | Logout confirmation dialog (already exists) |
| Profile: replace CSS arrow with `>` text | Other pages (no arrows) |
| Profile: remove .arrow and .logout-btn CSS | NavBar component (already text-only) |
| Delete 6 unused tabbar icon PNGs | Login page (already clean) |

## Customer Quote

> "打开 app，底部三个字，设置页清清爽爽，退出登录不抢眼但能找到。没有图标
> 干扰，看起来像个正经产品。"

## FAQ

**Q: Will text-only tabBar look weird?**
WeChat's own "Discover" tab and many production mini-programs use text-only
tabBars. It's a standard, supported pattern. The bar becomes shorter, giving
more screen to content.

**Q: Why not use `iconPath` with better icons?**
No icon is better than a bad icon. The current PNGs are generic placeholders.
When we have a designer, adding custom icon-font or SVG icons is easy. For now,
text is clean and intentional — not placeholder-looking.

**Q: What about the nav-bar component? It already has no icons.**
Correct. The nav-bar already uses "返回" text. No changes needed there. The
user's "navbar" likely referred to the bottom tabBar (common terminology
confusion in Chinese tech contexts).

**Q: Why delete the PNG files instead of leaving them?**
Dead files rot. They confuse future developers ("are these used somewhere?").
The git history preserves them if we ever need them back.
