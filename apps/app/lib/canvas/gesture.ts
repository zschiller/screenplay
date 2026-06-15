/**
 * Canvas Gesture — the in-flight interaction stage of the Canvas, the middle of
 * the triad **derive → gesture → commit** (Canvas Layout derives, Canvas
 * Operation commits; see `apps/app/CONTEXT.md`, "Canvas Gesture").
 *
 * `reduceGesture` is a pure, React-free, Yjs-free state machine. It reduces a
 * pointer/key {@link GestureEvent} against the current {@link GestureState} into
 * the next state, a {@link GesturePreview} (consumed by `deriveCanvasLayout` —
 * the gesture never derives geometry itself), and on release a
 * {@link GestureIntent} the component applies via a Canvas Operation (the
 * gesture never touches the Y.Doc; ADR 0001).
 *
 * One discriminated-union `GestureState` with `idle` as the resting state means
 * **exactly one gesture is active at a time** by construction, and the shared
 * cleanup (back to `idle`, empty preview) lives in one place.
 *
 * This is the tracer-bullet slice (#538): only the **gap-resize** path is wired
 * through the seam. The remaining gestures land in migration order (#535:
 * reorder → move/merge → marquee → device-resize), each adding its own arm to
 * the `GestureState` / `GestureEvent` / `GestureIntent` unions.
 */

/**
 * Context snapshotted when a gap-resize gesture starts. Subsequent events carry
 * only the live cursor; the math reads everything else from here, so per-event
 * payloads stay tiny.
 */
export type GapGestureContext = {
  groupId: string
  /** 1-based index of the dragged gap (the gap *before* member `gapIndex`). */
  gapIndex: number
  /** The group's gap at drag start — the baseline deltas accumulate against. */
  startGap: number
  /** Cursor X (canvas space) at drag start — deltas are measured from here. */
  startCanvasX: number
}

/**
 * The single active gesture, or `idle` at rest. New arms (reorder, move,
 * marquee, resize) join this union as each gesture is ported.
 */
export type GestureState =
  | { kind: "idle" }
  | { kind: "gap"; ctx: GapGestureContext; gap: number }

/**
 * Pointer/key input the FSM reduces. `start` snapshots the gesture context;
 * `move` carries only the live cursor; `release` commits; `cancel` aborts with
 * no intent.
 */
export type GestureEvent =
  | { type: "start"; start: GestureStart }
  | { type: "move"; cursor: { x: number; y: number } }
  | { type: "release" }
  | { type: "cancel" }

/** The per-kind payload that begins a gesture from `idle`. */
export type GestureStart = { kind: "gap"; ctx: GapGestureContext }

/**
 * What the gesture wants the Canvas to *show* mid-flight. Fed straight into
 * `deriveCanvasLayout`'s in-flight slice; the gesture computes no geometry of
 * its own. `gapOverride` replaces one group's gap so the row reflows live
 * without writing to the Y.Doc.
 */
export type GesturePreview = {
  gapOverride: { groupId: string; gap: number } | null
}

/** Empty preview — the resting state and the post-release/-cancel reset. */
export const EMPTY_PREVIEW: GesturePreview = { gapOverride: null }

/**
 * The descriptive result a completed gesture emits. The component applies it:
 * canvas-mutating intents through a Canvas Operation, selection-only ones
 * through local selection state. New arms (`moveBy`, `reorderMember`,
 * `mergeGroups`, `popOutToNewGroup`, `resizeLayer`, `marqueeSelect`, …) join as
 * each gesture is ported.
 */
export type GestureIntent = {
  type: "setGroupGap"
  groupId: string
  gap: number
}

export type GestureResult = {
  state: GestureState
  preview: GesturePreview
  intent?: GestureIntent
}

/**
 * Gap from the dragged handle's live cursor: dragging gap `j` by `dx` in world
 * space changes the shared per-group gap by `dx / (j - 0.5)` so the dragged
 * handle's center tracks the cursor (same proportional rule as the original
 * inline handler). Clamped at 0 — the gap can't go negative.
 */
function gapFromCursor(ctx: GapGestureContext, cursorX: number): number {
  const dx = cursorX - ctx.startCanvasX
  return Math.max(0, ctx.startGap + dx / (ctx.gapIndex - 0.5))
}

/**
 * Reduce one event against the current gesture state. Pure: same inputs always
 * produce the same `{ state, preview, intent? }`, so a synthetic event sequence
 * can be asserted against plain values with no React, DOM, or Y.Doc.
 */
export function reduceGesture(
  state: GestureState,
  event: GestureEvent
): GestureResult {
  switch (event.type) {
    case "start": {
      // A `start` always begins fresh from the snapshotted context. The single
      // active gesture is guaranteed by the union, so this is also how a stray
      // re-start resolves: the new gesture replaces whatever was in flight.
      const { start } = event
      if (start.kind === "gap") {
        return {
          state: { kind: "gap", ctx: start.ctx, gap: start.ctx.startGap },
          preview: {
            gapOverride: {
              groupId: start.ctx.groupId,
              gap: start.ctx.startGap,
            },
          },
        }
      }
      return { state, preview: previewFor(state) }
    }

    case "move": {
      if (state.kind === "gap") {
        const gap = gapFromCursor(state.ctx, event.cursor.x)
        return {
          state: { kind: "gap", ctx: state.ctx, gap },
          preview: { gapOverride: { groupId: state.ctx.groupId, gap } },
        }
      }
      // No gesture in flight — a move is just hover; nothing to reduce.
      return { state, preview: previewFor(state) }
    }

    case "release": {
      if (state.kind === "gap") {
        return {
          state: { kind: "idle" },
          preview: EMPTY_PREVIEW,
          intent: {
            type: "setGroupGap",
            groupId: state.ctx.groupId,
            gap: state.gap,
          },
        }
      }
      return { state, preview: previewFor(state) }
    }

    case "cancel":
      // Abort to rest with no intent — the in-flight preview is discarded.
      return { state: { kind: "idle" }, preview: EMPTY_PREVIEW }
  }
}

/** The preview a given state would show absent any event — used for no-ops. */
function previewFor(state: GestureState): GesturePreview {
  if (state.kind === "gap") {
    return { gapOverride: { groupId: state.ctx.groupId, gap: state.gap } }
  }
  return EMPTY_PREVIEW
}
