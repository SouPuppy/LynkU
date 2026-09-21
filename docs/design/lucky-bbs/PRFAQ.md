# Lucky BBS — PR/FAQ

## Problem

UNNC students currently use alink, the official platform, for campus communication. Alink is closed-source, controlled by the university administration, and lacks the informality and community ownership students want. There is no open, student-run alternative for:

- Course discussion and peer help
- Campus life (buy/sell, housing, events)
- Direct messaging between students
- Anonymous or semi-anonymous posting

A WeChat mini-program is the natural delivery platform — every UNNC student already uses WeChat daily. No app install, no separate account.

## Solution

**Lucky** — an open-source, non-profit WeChat mini-program BBS + private messaging platform.

- **Category-based forum**: Students post and reply in topic categories (Academic, Campus Life, Buy/Sell, Jobs, etc.)
- **Private messaging**: Real-time direct messages via WebSocket, with offline delivery
- **WeChat-native auth**: One-tap login via WeChat — no separate account, no email verification
- **Minimal moderation**: Sensitive word filter + admin review for flagged posts. Community-driven, not top-down.

### Architecture

```
WeChat Mini-Program (TypeScript, Skyline render)
       │
       │  REST (JWT) + WebSocket (WSS)
       ▼
FastAPI Backend (Python, async)
       │
       │  SQLAlchemy 2.0 (async)
       ▼
PostgreSQL
```

- **Frontend**: WeChat native mini-program (already scaffolded). TypeScript, Glass-Easel components, Skyline render engine.
- **Backend**: Python FastAPI. Layered architecture (Routes → Services → Repositories → Models). JWT auth via WeChat code exchange. WebSocket for real-time messaging.
- **Database**: PostgreSQL with async SQLAlchemy 2.0. Cursor-based pagination, full-text search via TSVECTOR.

### Scope

| In Scope | Out of Scope (MVP) |
|----------|-------------------|
| Category-based post listing + creation | Image/file uploads in posts |
| Nested comments (2 levels deep) | Rich text editor (plain text only) |
| Full-text search on posts | Push notifications |
| WeChat login (wx.login + JWT) | UNNC email/SSO verification |
| Real-time direct messaging (1:1) | Group chats |
| Online presence indicators | Message read receipts |
| Sensitive word filtering | Admin dashboard UI |
| Soft-delete for posts/comments | User blocking/reporting |
| Cursor-based pagination | OAuth/third-party login |

## Customer Quote

> "Finally, I can ask about course selection without my advisor seeing it. And DM classmates without adding them on WeChat first."
> — UNNC Year 2 Student

## FAQ

**Q: Why not just use a WeChat group chat?**
WeChat groups are ephemeral, hard to search, and max out at 500 members. A BBS preserves discussions, enables search, and scales to the entire student body.

**Q: Why WeChat mini-program instead of a web app?**
Every UNNC student has WeChat. A mini-program requires no install, no account creation, and runs inside an app they already use daily. A web app would have zero adoption.

**Q: How is this different from alink?**
Alink is university-administered, closed-source, and formal. Lucky is student-run, open-source, and designed for informal community use. Alink is the official channel; Lucky is the common room.

**Q: What tech stack and why?**
Python FastAPI backend — matches the `.claude/` AI harness tooling already in the project, full async support for WebSocket + HTTP on one server. WeChat native frontend — already scaffolded, best platform integration, Skyline render engine for smooth UI.

**Q: How does auth work without UNNC SSO?**
WeChat login (`wx.login()`) provides a unique openid. First login auto-creates an account. No password, no email — one tap. This also provides natural identity: your WeChat account IS your identity. Abuse is tied to a real WeChat account.

**Q: What about content moderation?**
Sensitive word filter runs server-side. Flagged posts are hidden from public view pending admin review. For a student community at UNNC scale, this is sufficient. Heavier moderation (ML-based, user reporting) added if needed.

**Q: What happens when the server goes down?**
Posts are served from PostgreSQL — REST API returns cached-like responses. Messages are persisted immediately on send. WebSocket disconnect shows a banner; messages queue locally and retry. No data loss on restart.

**Q: Is this really open-source?**
Yes. AGPLv3 license. The WeChat mini-program code is public. The backend is public. Anyone can fork it for their own campus.

## Design Documents

- Research Report: `docs/design/lucky-bbs/research_report.json`
- Topology Model: `docs/design/lucky-bbs/topology_model.json`
- Module Specs: `docs/design/lucky-bbs/module_specs.json`
- Audit Report: `docs/design/lucky-bbs/audit_report.json` — **verdict: PROCEED_WITH_WARNINGS** (1 deferred: Redis for rate limiting)
