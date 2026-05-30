# 1. Canvas Operations module — a deep write-seam for the room Y.Doc

Date: 2026-05-30

Status: Accepted

## Context

Committed canvas state lives in the room's Y.Doc, wrapped by the generic
`YjsCollection` CRDT helper (`lib/yjs/schema.ts`) — a thin, domain-agnostic
adapter (`set` / `update` / `delete` over a `Y.Map`) that knows nothing about
Groups, Members, or Chat Sessions. As a result every piece of canvas *meaning*
lives in `components/canvas/canvas.tsx` (~5,400 lines) across ~80 direct
mutation sites: copy-pasted invariants (the "remove a Member, delete the Group
if it is now empty, else write back" dance appears ~6×), a Markdown-Layer title
dual-write keyed by a hardcoded string, ~26 raw `collections.transact(` calls,
and no test surface (mutation logic only runs through React + a live Liveblocks
doc).

The parent refactor (#150) introduces a deep **Canvas Operations** module
fronting `YjsCollection` with meaning-bearing verbs. This ADR records the
seam's contract, established by its scaffold (#157). The verbs themselves land
incrementally in #158–#160.

## Decision

- **One module, one factory.** `createCanvasOps(collections)` in
  `lib/canvas/ops.ts` returns a `CanvasOps`. `canvas.tsx` instantiates it once
  via `useMemo(() => createCanvasOps(collections), [collections])`.

- **React-free, Y.Doc-only.** The module operates solely on `collections` (the
  room Y.Doc) — no React, no Liveblocks, no sandbox/server calls. Verbs take
  canvas-space coordinates; callers do the screen→canvas conversion. This is
  what makes the module testable against a bare `new Y.Doc()` (the harness in
  `test/canvas/harness.ts`).

- **A single transaction entry point.** `ops.batch(fn)` is the *only* way to
  open a transaction; it wraps `doc.transact(fn, CANVAS_OPS_ORIGIN)`. Named
  verbs self-wrap in `batch`, and multi-verb sequences compose under one outer
  `batch` (nested Yjs transactions reuse the outer one, preserving the origin).
  The raw `collections.transact(` calls leave `canvas.tsx` over #158–#160.

- **A uniform origin.** `CANVAS_OPS_ORIGIN` (an exported `Symbol`) tags every
  mutation committed through the seam. A future `Y.UndoManager` scoped to this
  origin gets canvas Undo/Redo nearly for free, tracking the canvas's own edits
  and nothing arriving from sync.

- **A generic `patch` for trivial writes.** `patch(key, id, fields)` merges a
  partial onto an existing record within the canvas-ops origin (no-op when the
  record is missing, mirroring `YjsCollection.update`). A site earns a *named*
  verb only if it touches ≥2 collections, enforces the Group invariant, or
  dual-writes a fragment; everything else goes through `patch`.

- **One Group-invariant chokepoint.** The Group invariant (CONTEXT.md: no Group
  is ever *committed* with zero Members) is enforced in exactly one internal
  helper, `pruneIfEmpty(groupId)`. It is not a public verb; the
  removal/restructure verbs (#158) route every Member-removing write through it.
  It is reachable for tests and those verbs via `ops.internal`, not as a
  top-level export.

## Consequences

- canvas.tsx mutation logic gains a home with a test surface: postcondition
  tests run against a bare `Y.Doc` with no React/Liveblocks, plus a reusable
  invariant sweep (`findEmptyGroups`) asserting no committed Group is empty.
- The seam is proven end-to-end before the meaning-bearing verbs exist: a
  handful of trivial single-field writes in `canvas.tsx` already go through
  `ops.patch`.
- Until #158–#160 migrate the remaining sites, `canvas.tsx` still holds direct
  `collections` writes and raw `collections.transact(` calls; the uniform-origin
  guarantee is only complete once that sweep (#160) lands.
- A `Y.UndoManager` scoped to `CANVAS_OPS_ORIGIN` is unblocked but out of scope.
