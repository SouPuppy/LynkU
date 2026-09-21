# AUDIT-010: Anonymous mode flag in editor is stale on page load

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/editor/editor.ts:6` imports `isAnonymous` from `services/anonymous`. The anonymous state is read once when the page loads (via `isAnonymous()` in `autoSave` and `onSubmit`). If the user toggles anonymous mode on the profile page while the editor is open, the editor still uses the old value. The editor reads `isAnonymous()` on every save/submit call, which always checks `wx.getStorageSync('anonymous_mode')` — so actually this is fine for storage-based reads.

BUT: the editor doesn't show the current anonymous state anywhere in the UI. The user can't tell whether their post will be anonymous or not while typing.

## Fix

Add a small indicator or toggle in the editor UI showing the current anonymous state.


## Resolution (2026-07-23)

编辑器显示并可切换当前匿名发布状态。
