# 26. Live frames are opt-in, and going live applies to everyone

Date: 2026-10-03

Status: Accepted (backfilled 2026-10-07)

## Context

Hosted frames could already be one shared, streamed browser
(`use-shared-frames.ts`), and that was on by default. Measured 2026-10-03: a
cold first picture ~0.6 s, six cold frames 2–4 s, ~5 Mbit/s per viewer for a
moving page, and a cost floor per sandbox plus data transfer per viewer. Zack:
the lag is bad, and a shared instance is only useful when two people
collaborate live or the agent drives, both rare.

## Decision

- **Frames are everyone's own copy by default** (ADR 0025), following the
  room's route, shared state and Knobs.
- **Go live is a per-frame toggle** (spec #1512, #1516, PR #1546). The `live`
  flag lives on the frame and syncs like its route, so turning it on puts
  everyone on the canvas on the one streamed browser, and turning it off ends it
  for everyone, each copy seeded from the live page. The rule is in
  `lib/frame-stream/live-frames.ts`.
- **The agent taking control turns a frame live** (#1522, PR #1561), and it
  stays live after the agent hands it back until someone ends it.
- **Mockups get the same toggle** (#1523, PR #1570). Not on the desktop app, which has
  per-viewer frames only.

## Consequences

- No lag or streaming cost unless someone asks for it.
- One person going live moves everyone's view of that frame, like a route
  change. There is no personal join.

Rejected: always live by default; taking control going live only for the
taker; a canvas-level live session; Go live as presenting with an owner;
pulling viewers onto a live frame as a separate action.
