# Research: Anonymous/Real-Name Mode + Theme System

> Phase 1 of design-pipeline. Two concerns: dual-identity posting model,
> and dynamic theme switching tied to identity mode.

## Ref 1: Dual-Identity Social Apps

**Prior art — Yik Yak**: Location-based anonymous posting. Users have a single
anonymous identity per community. Anonymity is the default; there is no
real-name mode. Key learning: anonymity increases participation but reduces
accountability. The dual-mode design is an improvement — users choose per
session.

**Prior art — Reddit**: Users have a persistent identity but can create
throwaway accounts. The UX friction of switching accounts is high. Key
learning: a single-tap toggle is superior to account switching for
frequent mode changes.

**Prior art — WeChat "漂流瓶" (Message in a Bottle)**: Anonymous messaging
within the WeChat ecosystem. Identity is hidden but the platform retains
backend traceability for moderation.

**Prior art — Zhihu (知乎)**: Allows anonymous answers. The author shows as
"匿名用户" but Zhihu retains real identity for moderation. Key learning:
anonymity is a display-layer feature, not a true identity erase. Backend
always knows.

## Ref 2: Theme Systems in Mini Programs

**WeChat mini program constraints**:
- No dynamic `app.json` — TabBar colors are static compile-time config
- CSS variables (`--color-*`) are the standard approach for dynamic theming
- `wx.setTabBarStyle()` can change TabBar text color at runtime
- TabBar icon color cannot be dynamically changed (pre-rendered images)
- Navigation bar color can be set per-page via `wx.setNavigationBarColor()`

**Industry pattern**: CSS custom properties on the `page` element, changed
via a root class toggle. Single `app.wxss` defines both themes as variable
sets. Pages respond automatically.

## Ref 3: Accountability in Anonymous Systems

Every platform that offers anonymity retains backend traceability:
- Yik Yak: requires phone verification, stores device ID
- Reddit: IP logging on anonymous posts
- Zhihu: real identity visible to moderators

Our design: anonymous posts store the real `_openid` server-side (for
moderation + abuse prevention) but display `anonymous: true` + generic
author info to other users. Admins can see real identity.

## Theme Values: UNNC Blue

UNNC brand guidelines reference a navy/academic blue. Selected palette:

```
Real-name mode (UNNC Blue):
  --color-primary:      #1E4D8C   (academic blue)
  --color-primary-dark: #163A6B   (darker for hover/gradient)
  TabBar selected:      #1E4D8C
  NavBar:               white bg, dark text

Anonymous mode (Gray):
  --color-primary:      #8E8E93   (neutral gray)
  --color-primary-dark: #6E6E73
  TabBar selected:      #8E8E93
  NavBar:               white bg, dark text
```
