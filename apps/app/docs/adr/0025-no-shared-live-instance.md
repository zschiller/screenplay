# 25. No shared live instance by default: each viewer runs their own copy, synced by the state package

Date: 2026-09-28

Status: Accepted (backfilled 2026-10-07; the opt-in exception is ADR 0026)

## Context

On a hosted canvas the dev server is already one shared VM per Workspace, but
each viewer's frame is their own browser runtime. Map #979 asked whether
everyone could interact with the same running instance instead, and
prototyped three routes:

- **Streaming one browser tab** (#980, #983): one instance, pictures sent to
  every viewer.
- **Leader DOM mirroring** (#982): one viewer's page mirrored into the others.
- **A smarter state package** (#984): own copies, with more state synced
  automatically through `@screenplay.space/state`.

## Decision

- **Viewers keep their own instance** (#985, closing map #979).
- **The state package carries what's shared**, limited to the "safe three"
  from #984: route sync on the client without a reload (#999), room state wins
  when a frame loads (#1000), and a one-line zustand `shareStore` (#1001).
  Knobs stay room-wide. Scroll is per person (#1518, PR #1532).
- **No automatic `useState` sync** through the DevTools hook: it worked but
  was fragile.

## Consequences

- Frames are fast and private to type into; nobody waits on a stream.
- DOM-only inputs, `<details>`, focus and server caches can still differ
  between viewers. Only one running instance fixes that, which is what Go
  live is for (ADR 0026).
- An app that wants more shared state wires it through `shareStore` itself.

Rejected: streaming as the default (too laggy); DOM mirroring ("too
compromised to be useful"); automatic `useState` sync. Don't re-propose a
shared instance as the default unless Zack reopens it.
