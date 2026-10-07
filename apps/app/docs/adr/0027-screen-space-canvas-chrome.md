# 27. Canvas chrome is drawn in screen space and follows the live camera

Date: 2026-10-06

Status: Accepted (backfilled 2026-10-07)

## Context

Layer labels, strokes and selection used to live inside the zoomed canvas
content and were counter-scaled by `1/zoom`. That made them blur and jump on
Mac WebKit, needed hide-during-zoom and zoom-settle tricks, and decided
visibility from the settled zoom, so labels popped after a zoom stopped. Which
labels showed at which zoom also felt random: a room-to-fit test and a global
25% cutoff fought each other.

## Decision

- **Labels live in a screen-space layer** (PR #1780). `LayerTitleBar` portals
  into `.canvas-label-layer` beside the zoomed content and positions itself from
  `camera.liveCamera` on every transform frame, snapped to device pixels, at UI
  size. No `1/zoom` scale.
- **Strokes are painted on a screen-space underlay canvas** (PR #1786):
  frames, Mockups and Documents have square corners and no CSS border; the 1px
  edge is drawn by `LayerEdgesUnderlay`, and the selection overlay above.
- **Visibility follows the layer's on-screen width only** (PR #1788): a label
  hides when its layer is under 64px wide (`showsLayerLabel`), never for room,
  and never at one global zoom. Resize handles follow the same per-layer idea
  (PR #1789). Anything label-sized reads the live camera, never deferred zoom
  (PR #1790).

## Consequences

- Chrome stays crisp and one size at every zoom, and nothing pops when a zoom
  ends.
- Every piece of chrome redraws per camera frame. Measured at 0.6 ms/frame
  with a 4× CPU throttle; new chrome has to stay that cheap.
- Labels can overprint the frame above in tight rows far out (accepted cost of
  width-only).

Rejected: labels in the zoomed content; hide-during-zoom; rows that agree on a
room test; groups taking over labels; a global zoom cutoff.
