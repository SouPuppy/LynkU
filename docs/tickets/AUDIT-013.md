# AUDIT-013: Editor auto-save/submit race condition leaks drafts

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`pages/editor/editor.ts:179-259` — When user submits within 2s of typing, the debounced auto-save may fire AFTER `onSubmit` navigates away. The newly created draft (from the in-flight auto-save) is never cleaned up because `draftId` wasn't set yet when `onSubmit` checked.

## Fix

Cancel the debounced save in `onSubmit` before creating the post. Or set a `_submitted` flag that `autoSave` checks.


## Resolution (2026-07-23)

提交前取消 debounce、等待在途保存，并用提交标记阻止卸载后的云端保存。
