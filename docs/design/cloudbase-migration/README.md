# Implemented CloudBase Design

This directory is the migration reference. The repository implementation has one privacy adjustment beyond the original proposal: posts, comments, profiles, notifications, drafts, and messages are cloud-function-only reads. Only categories are directly readable by clients. This prevents anonymous `_openid` exposure.

Use [docs/DEVELOPMENT.md](../../DEVELOPMENT.md) for the authoritative collection permissions, indexes, deployment list, and `clear-db` environment controls.
