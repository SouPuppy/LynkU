# ADR-001: Anonymous/Real-Name Dual Mode + UNNC Blue Theme

> Date: 2026-07-22
> Status: DESIGN gate — awaiting human approval

## Context

Lucky BBS is a student forum for UNNC. Students need to discuss courses,
professors, campus life, and sometimes sensitive topics (mental health, academic
difficulties). A persistent real-name identity discourages honest participation.
But full anonymity without accountability invites spam and toxicity.

We need a middle ground: users choose their identity mode, and the choice is
visually obvious so they never accidentally post under the wrong identity.

UNNC's brand identity (navy blue) should be reflected in the app's visual
language.

## Decision

### 1. Session-Level Dual Mode

Users toggle between **real-name** and **anonymous** mode. The toggle is on
the Profile page, highly visible. The mode persists across app restarts.

- **Real-name**: Posts and comments show the user's actual nickname and avatar.
- **Anonymous**: Posts and comments show "匿名用户" with a default avatar. The
  real `_openid` is stored server-side for moderation. Other users cannot see
  the real identity.

### 2. Content Is Immutable by Mode

Each post/comment captures its author display at creation time. Changing the
anonymous mode does NOT retroactively change existing content. This prevents
the scenario where a user posts anonymously, later switches to real-name,
and their old sensitive posts are suddenly attributed to them.

### 3. TabBar Color Reflects Mode

- Real-name: TabBar selected color = UNNC Blue (`#1E4D8C`)
- Anonymous: TabBar selected color = Neutral Gray (`#8E8E93`)

This is the primary visual cue. Users glance at the bottom of the screen and
instantly know which mode they're in.

### 4. Complete Theme Migration to UNNC Blue

Current primary color (WeChat green `#07c160`) → UNNC academic blue (`#1E4D8C`).
Dark variant: `#163A6B`. Anonymous mode uses gray (`#8E8E93`).

Theme is implemented via CSS custom properties on the `page` element. A single
`.anonymous` class on `page` swaps the entire color palette. All components
reference `var(--color-primary)` — no per-component changes needed.

### 5. Backend Accountability

Anonymous posts store the real `_openid` in the document (both in the top-level
`_openid` field and `author._openid`). The `author.nickname` is set to
`'匿名用户'` and `author.avatar_url` to `''`. Admins can always see real
identity. Cloud function moderation (flag, delete) works identically for
anonymous and real-name content.

## Consequences

### Positive
- Students more likely to participate in sensitive discussions
- Visual mode indicator prevents accidental identity leaks
- UNNC branding strengthens community identity
- Backend accountability prevents anonymous abuse
- Simple implementation: 1 new service module + CSS variable swap

### Negative
- Anonymous users may still self-identify in post content ("I'm in Prof. Li's
  Tuesday class") — this is user behavior, not a technical fix
- Moderation effort may increase for anonymous content
- TabBar color change has a ~100ms lag on some devices (API call)

### Neutral
- `anonymous` field on posts/comments is stored forever — database documents
  grow by 1 boolean field
- Theme CSS variables add ~10 lines to `app.wxss`

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|-----------------|
| Per-post anonymous toggle | Increases UI complexity; session-level is sufficient |
| Separate anonymous avatar set | Unnecessary — default avatar already exists |
| Anonymous accounts (throwaway) | Account switching UX is terrible for frequent use |
| Keep WeChat green theme | Doesn't match UNNC branding |
| Dark mode for anonymous | Low contrast; accessibility concerns |
