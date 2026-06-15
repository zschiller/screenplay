/**
 * Canvas Gesture — the in-flight interaction stage of the Canvas, the middle of
 * the triad **derive → gesture → commit** (Canvas Layout derives, Canvas
 * Operation commits; see `apps/app/CONTEXT.md`, "Canvas Gesture").
 *
 * `reduceGesture` is a pure, React-free, Yjs-free state machine. It reduces a
 * pointer/key {@link GestureEvent} against the current {@link GestureState} into
 * the next state, a {@link GesturePreview} (consumed by `deriveCanvasLayout` and
 * the overlays — the gesture never derives geometry itself), and a
 * {@link GestureIntent} the component applies via a Canvas Operation (the
 * gesture never touches the Y.Doc; ADR 0001).
 *
 * One discriminated-union `GestureState` with `idle` as the resting state means
 * **exactly one gesture is active at a time** by construction, and the shared
 * cleanup (back to `idle`, empty preview) lives in one place.
 *
 * Ported so far (#535 migration order: gap-resize → reorder → move/merge →
 * marquee → device-resize):
 *
 *   - **gap-resize** (#538): drag a group's gap handle, commit `setGroupGap` on
 *     release.
 *   - **reorder** (#542): in-flow reorder of a Member within its Group plus the
 *     meta-key pop-out into a new Group.
 *   - **group-move + move-snap + merge-snap** (#543): translate a Group (or the
 *     selection) with sticky edge/center snap, emitting `moveBy` live; a
 *     single-group drag goes "hot" against another Group's trailing slot and
 *     emits `mergeGroups` only on release.
 *
 * The move arm's Snap math is *orchestrated*, not reimplemented: it calls
 * `computeMoveSnap` / `computeMergeSnap` from `lib/canvas/snap` (also pure), so
 * this module still imports neither React nor Yjs.
 */

import type { GroupMember, GroupMemberKind } from "@/lib/types"
import {
  computeMergeSnap,
  computeMoveSnap,
  type MergeSnapCandidate,
  type Rect,
  type SnapGuide,
} from "@/lib/canvas/snap"

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
 * One Member's stable footprint in the dragged Group, snapshotted at reorder
 * start: the kind/id carried into the `reorderMember` intent and the width used
 * to walk sibling centers. `width` is `null` for a Member whose layer reference
 * is missing — it keeps its slot in the order but is skipped when walking
 * centers (matching the original inline handler).
 */
export type ReorderMemberSnapshot = {
  id: string
  kind: GroupMemberKind
  width: number | null
}

/**
 * Context snapshotted when a reorder gesture starts. The Group's anchor and gap
 * are stable for the drag (reordering Members never moves the Group), so the
 * sibling-center math reads them from here; only the live cursor and meta-key
 * state arrive per event.
 */
export type ReorderGestureContext = {
  groupId: string
  /** The Member being dragged. */
  memberId: string
  /** Its kind — carried into the select-on-no-move intent. */
  memberKind: GroupMemberKind
  /** The Group's left anchor (world space) — sibling centers walk from here. */
  groupX: number
  /** The Group's effective inter-member gap. */
  gap: number
  /** Vector from the Member's top-left to the cursor at drag start, so the
   *  popped Member stays under the exact spot the user grabbed. */
  grabOffset: { x: number; y: number }
  /** Cursor (canvas space) at drag start — the click-vs-drag threshold. */
  startCanvas: { x: number; y: number }
  /** Shift key at drag start — preserved for a select-on-no-move release. */
  startShiftKey: boolean
  /** When `true`, a no-move release selects the Member (drags begun from a
   *  Member's name label); `false` for the reorder dot, which isn't a
   *  selection affordance. */
  selectOnNoMove: boolean
}

/**
 * Context snapshotted when a group-move gesture starts. Everything stationary
 * for the drag is captured once here; `move` events carry only the cumulative
 * cursor delta. This formalizes what `canvas.tsx` already snapshotted at drag
 * start (the start-union, merge candidates, and member sizes).
 */
export type MoveGestureContext = {
  /**
   * Representative member ids whose groups translate — fed straight to the
   * `moveBy` intent (the component's `moveIframeLayersByDelta` finds each
   * member's group and shifts its anchor). Empty for a drag that moves nothing.
   */
  moveMemberIds: readonly string[]
  /** The single dragged Group, or `null` for a multi-group drag (no merge). */
  sourceGroupId: string | null
  /**
   * The dragged Group's world position at drag start. The merge check reads the
   * source's *live* position as `sourceStart + appliedTranslation`. `null` when
   * there is no single source group.
   */
  sourceStart: { x: number; y: number } | null
  /**
   * Edge/center move-snap inputs. `startUnion` is the world-space bbox of every
   * moving layer at drag start; `candidates` are the rects that *won't* move.
   * `null` when there's nothing to snap against (e.g. an isolated group or a
   * multi-group drag).
   */
  snap: { startUnion: Rect; candidates: readonly Rect[] } | null
  /**
   * Merge-snap inputs (stationary for the drag): the source's content size, its
   * member sizes (for the highlight preview), and every candidate Group's
   * trailing slot. `null` when the drag can't merge (multi-group, or no source).
   */
  merge: {
    sourceContentW: number
    sourceContentH: number
    memberSizes: ReadonlyArray<{ width: number; height: number }>
    candidates: readonly MergeSnapCandidate[]
  } | null
  /** Zoom at drag start — snap thresholds are evaluated in screen pixels. */
  zoom: number
}

/**
 * The single active gesture, or `idle` at rest. New arms (marquee, resize) join
 * this union as each gesture is ported.
 */
export type GestureState =
  | { kind: "idle" }
  | { kind: "gap"; ctx: GapGestureContext; gap: number }
  | {
      kind: "reorder"
      ctx: ReorderGestureContext
      /** Live Member order, updated as in-flow reorder reindexes the dragged
       *  Member. Frozen while popped (the meta-key preview leaves the Group as-is
       *  until release). */
      order: ReorderMemberSnapshot[]
      /** Last cursor (canvas space) — drives the preview between moves. */
      cursor: { x: number; y: number }
      /** True while meta/cmd is held: the Member pops out of its Group as a
       *  preview, committed to a new Group only on release while still held. */
      popped: boolean
    }
  | {
      kind: "move"
      ctx: MoveGestureContext
      /** Cumulative cursor delta last seen — incremental = `total - prevTotal`. */
      prevTotal: { x: number; y: number }
      /** Move-snap offset currently baked into the world position (sticky-snap). */
      appliedSnap: { x: number; y: number }
      /** Accumulated applied translation of the source group — drives merge. */
      sourceApplied: { x: number; y: number }
      /** Snap Guides currently shown — retained so a `metaChange` preserves them. */
      guides: SnapGuide[]
      /** The hot merge target, or `null`. Reflects the latest meta state. */
      targetId: string | null
      /** Latest meta/cmd state — `release` reads it to gate the merge commit. */
      meta: boolean
    }

/**
 * Pointer/key input the FSM reduces. `start` snapshots the gesture context;
 * `move` carries the live cursor (for the move arm, the cumulative delta from
 * drag start) and meta-key state for gestures that read it; `metaChange` flips
 * the meta-key between moves (a key press with no pointer motion); `release`
 * commits; `cancel` aborts with no intent.
 */
export type GestureEvent =
  | { type: "start"; start: GestureStart }
  | { type: "move"; cursor: { x: number; y: number }; meta?: boolean }
  | { type: "metaChange"; meta: boolean }
  | { type: "release"; cursor?: { x: number; y: number }; meta?: boolean }
  | { type: "cancel" }

/** The per-kind payload that begins a gesture from `idle`. */
export type GestureStart =
  | { kind: "gap"; ctx: GapGestureContext }
  | {
      kind: "reorder"
      ctx: ReorderGestureContext
      order: ReorderMemberSnapshot[]
      /** Meta-key state at grab — pops out immediately if cmd is already held. */
      meta: boolean
    }
  | { kind: "move"; ctx: MoveGestureContext }

/**
 * A reorder drag the Canvas shows mid-flight: the dragged Member floats at
 * `cursor` offset by `grabOffset`, and (while `popped`) `deriveCanvasLayout`
 * lifts it out of its Group so the siblings reflow. The component reads this to
 * place the dragged Member's translate; `deriveCanvasLayout` reads it (via the
 * mapping in `canvas.tsx`) for the pop-out reflow.
 */
export type ReorderPreview = {
  memberId: string
  cursor: { x: number; y: number }
  grabOffset: { x: number; y: number } | null
  /** True while meta/cmd is held — the Member is lifted out of its Group. */
  popped: boolean
}

/**
 * What the gesture wants the Canvas to *show* mid-flight. Fed straight into
 * `deriveCanvasLayout`'s in-flight slice and the overlays; the gesture computes
 * no geometry of its own.
 *
 *   - `gapOverride` replaces one group's gap so the row reflows live (gap-resize).
 *   - `reorder` floats/pops the dragged Member (reorder).
 *   - `snapGuides` are the red edge/center guide lines drawn during a move.
 *   - `mergeRects` are the merge-preview highlight rects while a group drag is
 *     hot against a target, else `null`.
 *
 * Each is empty/null outside its gesture.
 */
export type GesturePreview = {
  gapOverride: { groupId: string; gap: number } | null
  reorder: ReorderPreview | null
  snapGuides: SnapGuide[]
  mergeRects: Rect[] | null
}

/** Empty preview — the resting state and the post-release/-cancel reset. */
export const EMPTY_PREVIEW: GesturePreview = {
  gapOverride: null,
  reorder: null,
  snapGuides: [],
  mergeRects: null,
}

/**
 * The descriptive result a completed (or in-flight) gesture emits. The
 * component applies it: canvas-mutating intents through a Canvas Operation,
 * selection-only ones through local selection state. New arms (`resizeLayer`,
 * `marqueeSelect`, …) join as each gesture is ported.
 *
 * - `setGroupGap` / `reorderMember` / `popOutToNewGroup` / `mergeGroups`:
 *   canvas writes.
 * - `moveBy`: translate the dragged groups by one incremental (snapped) delta;
 *   emitted live on every move, so collaborators see the drag in real time.
 * - `selectMember`: selection only — a no-move release that falls through to a
 *   plain click (label drags), so click-vs-drag stays in the gesture.
 */
export type GestureIntent =
  | { type: "setGroupGap"; groupId: string; gap: number }
  | { type: "reorderMember"; groupId: string; members: GroupMember[] }
  | { type: "popOutToNewGroup"; memberId: string; x: number; y: number }
  | { type: "moveBy"; memberIds: readonly string[]; dx: number; dy: number }
  | { type: "mergeGroups"; sourceId: string; targetId: string }
  | {
      type: "selectMember"
      memberId: string
      kind: GroupMemberKind
      additive: boolean
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

/** Pixels the cursor must travel before a release counts as a drag, not a click. */
const REORDER_CLICK_SLOP = 3

/**
 * Destination index for the dragged Member from the live cursor X: walk the
 * siblings (Members other than the dragged one) left-to-right and drop before
 * the first whose center sits right of the cursor, else at the end. Sizeless
 * Members keep their slot but don't advance the walk (matching the original
 * inline handler). Returns the reindexed order and whether it changed.
 */
function reorderByCursor(
  ctx: ReorderGestureContext,
  order: ReorderMemberSnapshot[],
  cursorX: number
): { order: ReorderMemberSnapshot[]; changed: boolean } {
  const currentIndex = order.findIndex((m) => m.id === ctx.memberId)
  if (currentIndex < 0) return { order, changed: false }

  let walkX = ctx.groupX
  const siblingCenters: number[] = []
  for (const m of order) {
    if (m.width == null) continue
    if (m.id !== ctx.memberId) siblingCenters.push(walkX + m.width / 2)
    walkX += m.width + ctx.gap
  }

  let newIndex = siblingCenters.length
  for (let i = 0; i < siblingCenters.length; i++) {
    if (cursorX < siblingCenters[i]!) {
      newIndex = i
      break
    }
  }
  if (newIndex === currentIndex) return { order, changed: false }

  const dragged = order[currentIndex]!
  const without = order.filter((m) => m.id !== ctx.memberId)
  without.splice(newIndex, 0, dragged)
  return { order: without, changed: true }
}

/** The reorder slice of the preview for a reorder state. */
function reorderPreviewOf(state: {
  ctx: ReorderGestureContext
  cursor: { x: number; y: number }
  popped: boolean
}): ReorderPreview {
  return {
    memberId: state.ctx.memberId,
    cursor: state.cursor,
    grabOffset: state.ctx.grabOffset,
    popped: state.popped,
  }
}

/** The `reorderMember` intent carrying the dragged Group's new Member order. */
function reorderIntent(
  groupId: string,
  order: ReorderMemberSnapshot[]
): GestureIntent {
  return {
    type: "reorderMember",
    groupId,
    members: order.map((m) => ({ kind: m.kind, id: m.id })),
  }
}

/**
 * Recompute the sticky edge/center snap for a move. `total` is the cumulative
 * cursor delta; `dx`/`dy` the increment since the last move; `prevSnap` the
 * offset already baked into the world position. Returns the *incremental* delta
 * to actually apply (`dx + (newSnap - prevSnap)`), the new applied snap, and the
 * guides. The rect "sticks" to a guide because the snap delta absorbs the cursor
 * shift until it exceeds the threshold; meta held releases the lock, popping the
 * rect back to the raw cursor.
 */
function moveSnapStep(
  ctx: MoveGestureContext,
  total: { x: number; y: number },
  prevSnap: { x: number; y: number },
  dx: number,
  dy: number,
  meta: boolean
): {
  adjDx: number
  adjDy: number
  snap: { x: number; y: number }
  guides: SnapGuide[]
} {
  if (!ctx.snap) {
    return { adjDx: dx, adjDy: dy, snap: { x: 0, y: 0 }, guides: [] }
  }
  if (meta) {
    // Cmd/meta held → bypass snap and release any active lock. The "release"
    // delta (-prevSnap) pops the rect back to its raw cursor position.
    return {
      adjDx: dx - prevSnap.x,
      adjDy: dy - prevSnap.y,
      snap: { x: 0, y: 0 },
      guides: [],
    }
  }
  const rawRect: Rect = {
    x: ctx.snap.startUnion.x + total.x,
    y: ctx.snap.startUnion.y + total.y,
    width: ctx.snap.startUnion.width,
    height: ctx.snap.startUnion.height,
  }
  const { snapDx, snapDy, guides } = computeMoveSnap({
    rect: rawRect,
    candidates: ctx.snap.candidates as Rect[],
    zoom: ctx.zoom,
  })
  return {
    adjDx: dx + (snapDx - prevSnap.x),
    adjDy: dy + (snapDy - prevSnap.y),
    snap: { x: snapDx, y: snapDy },
    guides,
  }
}

/**
 * Recompute the merge-snap from the source group's live position
 * (`sourceStart + sourceApplied`). Returns the hot target and the highlight
 * rects, or both empty when the drag can't merge (no source, no candidates, or
 * meta held to drop freely).
 */
function mergeStep(
  ctx: MoveGestureContext,
  sourceApplied: { x: number; y: number },
  meta: boolean
): { targetId: string | null; rects: Rect[] | null } {
  if (!ctx.merge || !ctx.sourceGroupId || !ctx.sourceStart || meta) {
    return { targetId: null, rects: null }
  }
  const result = computeMergeSnap({
    rect: {
      x: ctx.sourceStart.x + sourceApplied.x,
      y: ctx.sourceStart.y + sourceApplied.y,
      width: ctx.merge.sourceContentW,
      height: ctx.merge.sourceContentH,
    },
    memberSizes: ctx.merge.memberSizes,
    candidates: ctx.merge.candidates,
    zoom: ctx.zoom,
  })
  return { targetId: result?.targetId ?? null, rects: result?.rects ?? null }
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
            reorder: null,
            snapGuides: [],
            mergeRects: null,
          },
        }
      }
      if (start.kind === "reorder") {
        const next = {
          kind: "reorder" as const,
          ctx: start.ctx,
          order: start.order,
          cursor: start.ctx.startCanvas,
          popped: start.meta,
        }
        return { state: next, preview: previewFor(next) }
      }
      // start.kind === "move": seed the merge preview from the resting position
      // so a drag that begins already over a target's slot goes hot at once.
      const { targetId, rects } = mergeStep(start.ctx, { x: 0, y: 0 }, false)
      const next: GestureState = {
        kind: "move",
        ctx: start.ctx,
        prevTotal: { x: 0, y: 0 },
        appliedSnap: { x: 0, y: 0 },
        sourceApplied: { x: 0, y: 0 },
        guides: [],
        targetId,
        meta: false,
      }
      return {
        state: next,
        preview: {
          gapOverride: null,
          reorder: null,
          snapGuides: [],
          mergeRects: rects,
        },
      }
    }

    case "move": {
      if (state.kind === "gap") {
        const gap = gapFromCursor(state.ctx, event.cursor.x)
        return {
          state: { kind: "gap", ctx: state.ctx, gap },
          preview: {
            gapOverride: { groupId: state.ctx.groupId, gap },
            reorder: null,
            snapGuides: [],
            mergeRects: null,
          },
        }
      }
      if (state.kind === "reorder") {
        const popped = event.meta ?? state.popped
        // Holding meta previews popping the Member out into a new Group; the
        // data write is deferred to release, so the in-flow reorder pauses and
        // the order stays frozen until meta is let go.
        if (popped) {
          const next = { ...state, cursor: event.cursor, popped: true }
          return { state: next, preview: previewFor(next) }
        }
        const { order, changed } = reorderByCursor(
          state.ctx,
          state.order,
          event.cursor.x
        )
        const next = { ...state, cursor: event.cursor, popped: false, order }
        return {
          state: next,
          preview: previewFor(next),
          intent: changed ? reorderIntent(state.ctx.groupId, order) : undefined,
        }
      }
      if (state.kind === "move") {
        const total = event.cursor
        const meta = event.meta ?? false
        const dx = total.x - state.prevTotal.x
        const dy = total.y - state.prevTotal.y
        const { adjDx, adjDy, snap, guides } = moveSnapStep(
          state.ctx,
          total,
          state.appliedSnap,
          dx,
          dy,
          meta
        )
        const sourceApplied = {
          x: state.sourceApplied.x + adjDx,
          y: state.sourceApplied.y + adjDy,
        }
        const { targetId, rects } = mergeStep(state.ctx, sourceApplied, meta)
        const next: GestureState = {
          kind: "move",
          ctx: state.ctx,
          prevTotal: total,
          appliedSnap: snap,
          sourceApplied,
          guides,
          targetId,
          meta,
        }
        const preview: GesturePreview = {
          gapOverride: null,
          reorder: null,
          snapGuides: guides,
          mergeRects: rects,
        }
        // Apply the move live (every move) so collaborators see the drag in real
        // time — only the merge waits for release.
        if (state.ctx.moveMemberIds.length > 0) {
          return {
            state: next,
            preview,
            intent: {
              type: "moveBy",
              memberIds: state.ctx.moveMemberIds,
              dx: adjDx,
              dy: adjDy,
            },
          }
        }
        return { state: next, preview }
      }
      // No gesture in flight — a move is just hover; nothing to reduce.
      return { state, preview: previewFor(state) }
    }

    case "metaChange": {
      // A key press/release with no pointer motion.
      if (state.kind === "reorder") {
        // Flip the pop-out preview at the last cursor. The in-flow reindex waits
        // for the next move (matching the original key listener, which only
        // toggled the popped flag).
        const next = { ...state, popped: event.meta }
        return { state: next, preview: previewFor(next) }
      }
      if (state.kind === "move") {
        // Flip the merge preview (and clear the hot target) without moving
        // anything. Move-snap keeps its current lock — it's released on the next
        // actual move, matching the original effect.
        const { targetId, rects } = mergeStep(
          state.ctx,
          state.sourceApplied,
          event.meta
        )
        return {
          state: { ...state, targetId, meta: event.meta },
          preview: {
            gapOverride: null,
            reorder: null,
            snapGuides: state.guides,
            mergeRects: rects,
          },
        }
      }
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
      if (state.kind === "reorder") {
        const cursor = event.cursor ?? state.cursor
        const meta = event.meta ?? state.popped
        const moved =
          Math.abs(cursor.x - state.ctx.startCanvas.x) > REORDER_CLICK_SLOP ||
          Math.abs(cursor.y - state.ctx.startCanvas.y) > REORDER_CLICK_SLOP
        let intent: GestureIntent | undefined
        if (!moved && state.ctx.selectOnNoMove) {
          // Click-no-move from a label → fall through to a plain selection.
          intent = {
            type: "selectMember",
            memberId: state.ctx.memberId,
            kind: state.ctx.memberKind,
            additive: state.ctx.startShiftKey,
          }
        } else if (meta) {
          // Meta still held → commit the pop into a fresh Group at the cursor.
          intent = {
            type: "popOutToNewGroup",
            memberId: state.ctx.memberId,
            x: cursor.x - state.ctx.grabOffset.x,
            y: cursor.y - state.ctx.grabOffset.y,
          }
        }
        // In-flow reorder needs no release intent: each move already committed.
        return { state: { kind: "idle" }, preview: EMPTY_PREVIEW, intent }
      }
      if (state.kind === "move") {
        const meta = event.meta ?? state.meta
        // Commit the merge only when a target is hot and meta isn't held. The
        // live position is already committed via the per-move `moveBy` intents.
        if (state.ctx.sourceGroupId && state.targetId && !meta) {
          return {
            state: { kind: "idle" },
            preview: EMPTY_PREVIEW,
            intent: {
              type: "mergeGroups",
              sourceId: state.ctx.sourceGroupId,
              targetId: state.targetId,
            },
          }
        }
        return { state: { kind: "idle" }, preview: EMPTY_PREVIEW }
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
    return {
      gapOverride: { groupId: state.ctx.groupId, gap: state.gap },
      reorder: null,
      snapGuides: [],
      mergeRects: null,
    }
  }
  if (state.kind === "reorder") {
    return {
      gapOverride: null,
      reorder: reorderPreviewOf(state),
      snapGuides: [],
      mergeRects: null,
    }
  }
  if (state.kind === "move") {
    const { rects } = mergeStep(state.ctx, state.sourceApplied, state.meta)
    return {
      gapOverride: null,
      reorder: null,
      snapGuides: state.guides,
      mergeRects: rects,
    }
  }
  return EMPTY_PREVIEW
}
