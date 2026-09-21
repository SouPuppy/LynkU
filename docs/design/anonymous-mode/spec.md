# Module Specifications: Anonymous Mode + Theme

> Phase 3 of design-pipeline.

## N1: services/anonymous.ts (new)

### Interface: `isAnonymous(): boolean`
- **Preconditions**: None
- **Postconditions**: Returns current mode. Defaults to `false` (real-name).
- **Side effects**: Reads `wx.getStorageSync('anonymous_mode')`
- **Failure modes**: FM1: Storage read error → returns `false` (safe default)

### Interface: `toggle(): boolean`
- **Preconditions**: None
- **Postconditions**: Flips the stored boolean. Writes to storage. Applies theme change. Returns new value.
- **Side effects**: Writes `wx.setStorageSync('anonymous_mode')`, calls `applyTheme()`
- **Failure modes**: FM1: Storage write error → logged, return current value

### Interface: `applyTheme(): void`
- **Preconditions**: None
- **Postconditions**: Sets `page` CSS class to `anonymous` or removes it. Calls `wx.setTabBarStyle()` with correct selectedColor.
- **Side effects**: DOM class change, TabBar API call
- **Failure modes**: FM1: TabBar API error → logged, CSS fallback still works

---

## N2: app.wxss (theme layer)

### Real-name theme (default)
```css
page {
  --color-primary: #1E4D8C;
  --color-primary-dark: #163A6B;
}
```

### Anonymous theme
```css
page.anonymous {
  --color-primary: #8E8E93;
  --color-primary-dark: #6E6E73;
}
```

All components reference `var(--color-primary)` — they respond automatically.

---

## M1/M2: Cloud Functions (modified)

### `createPost` / `createComment` — new parameter: `anonymous: boolean`

- **If `anonymous === true`**: store `author.nickname = '匿名用户'`, `author.avatar_url = ''`. Real `_openid` stored in `_openid` field and `author._openid`.
- **If `anonymous === false` or absent**: existing behavior (fetch real author profile).
- **`anonymous` field**: stored on the post/comment document for display decisions.
- **Failure modes**: Same as existing create flow.

---

## M3/M4: Components (modified)

- `post-item`: If `post.author.nickname === '匿名用户'`, show default avatar + "匿名用户" label.
- `comment-item`: Same logic. Anonymous comments get no "回复" link attribution.

---

## M5: pages/index/index.ts (modified)

- Before `submitComment` or navigating to editor: read `anonymous.isAnonymous()`.
- Pass `anonymous` flag to `createPost()` / `createComment()`.

---

## N4: pages/profile/profile.wxml (modified)

- Add toggle row between user info and menu:
```html
<view class="menu-row">
  <text>匿名模式</text>
  <switch checked="{{anonymousMode}}" bindchange="onToggleAnonymous" color="#8E8E93" />
</view>
```
- `onToggleAnonymous`: calls `anonymous.toggle()`, updates `anonymousMode` in data.
