# AUDIT-005: sendMessage allows empty content after trim

| Field | Value |
|-------|-------|
| Status | DONE |
| Type | bug |
| Priority | medium |
| Parent | null |
| Created | 2026-07-23 |

## Bug

`cloudfunctions/messages/index.js:22-24` — `validateInput(content, { maxLen: 5000 })` checks max length but not min length. `content.trim()` could be empty string. An empty message gets stored.

## Fix

Add `minLen: 1` to the validation:
```javascript
const cv = validateInput(content, { minLen: 1, maxLen: 5000 })
```


## Resolution (2026-07-23)

消息内容使用 trim 后的 `minLen: 1` 校验。
