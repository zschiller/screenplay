# 12. Decompose the Canvas root by domain, not by render-vs-logic

Date: 2026-06-15

Status: Accepted

## Context

`components/canvas/canvas.tsx` is still ~2,000 lines and remains the hardest
file in the app to work in — for humans and AI agents alike. Twenty-plus PRs
lifted its behaviour into deep controllers (Canvas Gesture, Selection, Camera,
Tool Mode, Tab Pool, Chat-Target, Branch Intake, Branch Actions, Element
Reference, Layer Mutations, Terminal Tabs, Sandbox Reconnect), and three more
recent cuts pulled out coherent concepts (the draw tools, the gesture-commit
apply-side, the frame-action handlers). Each extraction was correct, yet the
root barely shrinks: the bulk that remains is not business logic but *orphan
glue* — thin mutator callbacks threaded as props, cross-cutting interaction
state no controller owns, and a pile of sync effects with no home.

The recurring shortcut a reviewer (human or agent) reaches for when they see a
2,000-line root is the **render-vs-logic split**: collapse the file into a small
render shell plus one giant orchestration hook (`useCanvasRoom`) that returns
everything the JSX needs. It was tried and reverted. This ADR records *why*, so
the decomposition strategy is captured and no future cycle re-suggests the
aggregator. It accompanies the work described in #588.

## Decision

**Decompose the Canvas root by domain.** Each canvas feature lives in exactly
**one** controller (one deep module per concept), and the root collapses to
"instantiate N controllers, render the tree" as a *consequence* of each
controller finally being complete — not via a mechanical render/logic seam. The
metric of success is **navigability, not line count**: to change feature X, you
open exactly one controller.

The orphan glue moves into the controller that owns its concept, and the
genuinely homeless state and effects get their own small, named controllers
(e.g. a Group Operations controller — the structural sibling of the per-Layer
`useLayerMutations` — a Canvas Interaction controller around the existing pure
`reconcileInteractionMode` / `resolveEscapeAction` decisions, Branch Intake
absorbing the repo/branch storage writes it already orchestrates, and each sync
effect reassigned to the controller whose state it reconciles).

This is the payoff of **ADR 0001 (Canvas Operations)**. Because every committed
mutation already routes through the `ops` seam — a single transaction entry
point, the one Group-invariant chokepoint, and a uniform origin — moving the
structural writes into a Group Operations controller is mechanical and safe:
the invariants travel with the verbs, not with the file they happen to sit in.
The per-domain moves are seams the codebase already proved out, not new risks.

## Rejected alternative: the `useCanvasRoom` render-vs-logic aggregator

Collapsing the root into a render shell plus a single `useCanvasRoom`
orchestration hook is **explicitly rejected**. It optimises for the wrong
metric — file length — and is a *mechanical* seam, not a *domain* one:

- **It splits a single feature across two files.** A feature like "drag a
  frame" ends up half in the orchestration hook (the state and handlers) and
  half in the render shell (the JSX that wires them up). Following one feature
  now means bouncing between the two files — the exact navigation cost the
  split was meant to remove.
- **The orchestration becomes a ~1,500-line god-hook.** All the logic that was
  scattered through the root is now scattered through one hook instead. Nothing
  is localized; the haystack just moved.
- **The hand-off is a ~120-name destructure.** The render shell receives
  everything the hook returns as one enormous destructure — itself a navigation
  tax, and a merge-conflict magnet, with no domain meaning to the grouping.
- **Net result: a smaller file that is *less* navigable.** The render shell is
  short, but the question "where does feature X live?" now has two answers
  instead of one. We are not trading correctness for brevity.

The chosen alternative — decompose by domain — gives the same short root as a
*consequence*, while keeping each feature in one place.

## Consequences

- The Canvas root reads as a list of controller instantiations plus the render
  tree; its structure can be described from the root alone.
- Each canvas feature is owned by exactly one controller, so changing a feature
  means opening exactly one file — navigable because behaviour is localized, not
  merely because the root is shorter.
- Any concept named by a new controller is added to CONTEXT.md so the glossary
  keeps describing the real structure.
- The structural canvas mutations sit beside the per-Layer mutations as parallel
  deep modules, both routing through Canvas Operations (ADR 0001) — never the
  Y.Doc directly — so the single-transaction entry point, the Group-invariant
  chokepoint, and the uniform origin are all preserved.
- No schema, API, or wire-format change: every move is internal client
  composition. If a future reader is tempted to "just split render from logic"
  to shrink the root, this record is the answer for why that smaller file would
  be the wrong trade.
