# AUDIT-006: Editor — _autoSaveTimer dead code

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | low |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/editor/editor.ts:46` — `clearTimeout(this._autoSaveTimer)` clears a timer that was never set. The auto-save uses `debounce()` which manages its own internal timer. The `_autoSaveTimer` field is never assigned. The clearTimeout is a no-op.

## Fix

Remove `_autoSaveTimer` field and `clearTimeout` call. The `debounce` function handles timing internally.


## Resolution (2026-07-23)

编辑器使用可取消 debounce，不再维护死的 `_autoSaveTimer`。
