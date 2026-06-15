import { describe, expect, it } from "vitest"
import {
  EMPTY_PREVIEW,
  reduceGesture,
  type GapGestureContext,
  type GestureEvent,
  type GestureResult,
  type GestureState,
  type MarqueeGestureContext,
  type MoveGestureContext,
  type ReorderGestureContext,
  type ReorderMemberSnapshot,
} from "@/lib/canvas/gesture"

// Plain fixtures — no React, no DOM, no Y.Doc. Feed `reduceGesture` a synthetic
// event sequence and assert the resulting Gesture Intent and Gesture Preview
// against plain values. The gap math: dragging gap `j` by `dx` changes the
// shared gap by `dx / (j - 0.5)`, clamped at 0.

/** Fold an event sequence from `idle`, returning the final reducer result. */
function run(events: GestureEvent[]): GestureResult {
  let state: GestureState = { kind: "idle" }
  let result: GestureResult = { state, preview: EMPTY_PREVIEW }
  for (const event of events) {
    result = reduceGesture(state, event)
    state = result.state
  }
  return result
}

const ctx: GapGestureContext = {
  groupId: "g1",
  gapIndex: 1,
  startGap: 50,
  startCanvasX: 100,
}

describe("reduceGesture — gap-resize", () => {
  it("starts from idle: snapshots context and previews the unchanged gap", () => {
    const result = reduceGesture(
      { kind: "idle" },
      { type: "start", start: { kind: "gap", ctx } }
    )

    expect(result.state).toEqual({ kind: "gap", ctx, gap: 50 })
    expect(result.preview).toEqual({
      gapOverride: { groupId: "g1", gap: 50 },
      reorder: null,
      snapGuides: [],
      mergeRects: null,
      marqueeRect: null,
    })
    expect(result.intent).toBeUndefined()
  })

  it("previews the live gap on move without emitting an intent", () => {
    // gapIndex 1 → divisor (1 - 0.5) = 0.5. Cursor moves +20 in x, so the gap
    // grows by 20 / 0.5 = 40: 50 → 90. No intent until release.
    const result = run([
      { type: "start", start: { kind: "gap", ctx } },
      { type: "move", cursor: { x: 120, y: 0 } },
    ])

    expect(result.state).toEqual({ kind: "gap", ctx, gap: 90 })
    expect(result.preview).toEqual({
      gapOverride: { groupId: "g1", gap: 90 },
      reorder: null,
      snapGuides: [],
      mergeRects: null,
      marqueeRect: null,
    })
    expect(result.intent).toBeUndefined()
  })

  it("commits the previewed gap as a setGroupGap intent on release", () => {
    const result = run([
      { type: "start", start: { kind: "gap", ctx } },
      { type: "move", cursor: { x: 120, y: 0 } },
      { type: "release" },
    ])

    expect(result.intent).toEqual({
      type: "setGroupGap",
      groupId: "g1",
      gap: 90,
    })
    // Back to rest with no lingering preview.
    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
  })

  it("clamps the gap at 0 when dragged past the members' touching edge", () => {
    // Cursor moves -200: 50 + (-200 / 0.5) = -350, clamped to 0.
    const result = run([
      { type: "start", start: { kind: "gap", ctx } },
      { type: "move", cursor: { x: -100, y: 0 } },
      { type: "release" },
    ])

    expect(result.intent).toEqual({
      type: "setGroupGap",
      groupId: "g1",
      gap: 0,
    })
  })

  it("scales the delta by the dragged gap's index", () => {
    // gapIndex 3 → divisor (3 - 0.5) = 2.5. Cursor +25 → gap grows by 10.
    const farCtx: GapGestureContext = { ...ctx, gapIndex: 3, startCanvasX: 0 }
    const result = run([
      { type: "start", start: { kind: "gap", ctx: farCtx } },
      { type: "move", cursor: { x: 25, y: 0 } },
    ])

    expect(result.preview.gapOverride).toEqual({ groupId: "g1", gap: 60 })
    expect(result.preview.reorder).toBeNull()
  })

  it("uses the last cursor position, not accumulated deltas, across moves", () => {
    const result = run([
      { type: "start", start: { kind: "gap", ctx } },
      { type: "move", cursor: { x: 120, y: 0 } },
      { type: "move", cursor: { x: 110, y: 0 } },
      { type: "release" },
    ])

    // Final cursor +10 from start → gap 50 + 10/0.5 = 70 (not 50 + 40 + 20).
    expect(result.intent).toEqual({
      type: "setGroupGap",
      groupId: "g1",
      gap: 70,
    })
  })

  it("cancels back to idle with no intent, discarding the preview", () => {
    const result = run([
      { type: "start", start: { kind: "gap", ctx } },
      { type: "move", cursor: { x: 120, y: 0 } },
      { type: "cancel" },
    ])

    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
    expect(result.intent).toBeUndefined()
  })

  it("ignores move and release while idle (single-active invariant)", () => {
    const idle: GestureState = { kind: "idle" }
    expect(
      reduceGesture(idle, { type: "move", cursor: { x: 5, y: 5 } })
    ).toEqual({
      state: idle,
      preview: EMPTY_PREVIEW,
    })
    expect(reduceGesture(idle, { type: "release" })).toEqual({
      state: idle,
      preview: EMPTY_PREVIEW,
    })
  })

  it("replaces an in-flight gesture on a fresh start (one active at a time)", () => {
    const inFlight: GestureState = { kind: "gap", ctx, gap: 90 }
    const other: GapGestureContext = {
      groupId: "g2",
      gapIndex: 2,
      startGap: 30,
      startCanvasX: 0,
    }
    const result = reduceGesture(inFlight, {
      type: "start",
      start: { kind: "gap", ctx: other },
    })

    expect(result.state).toEqual({ kind: "gap", ctx: other, gap: 30 })
    expect(result.preview).toEqual({
      gapOverride: { groupId: "g2", gap: 30 },
      reorder: null,
      snapGuides: [],
      mergeRects: null,
      marqueeRect: null,
    })
  })
})

// Plain fixtures for the reorder gesture. A three-Member group anchored at x=0:
// member "a" [0..100], "b" [120..220], "c" [240..340] with gap 20. Sibling
// centers (excluding the dragged one) decide the drop index. Dragging from the
// reorder dot does not select on a no-move release; dragging from a label does.
const reorderOrder: ReorderMemberSnapshot[] = [
  { id: "a", kind: "iframe-layer", width: 100 },
  { id: "b", kind: "iframe-layer", width: 100 },
  { id: "c", kind: "iframe-layer", width: 100 },
]

/** Reorder ctx for dragging member `id`, defaulting to the dot (no select). */
function reorderCtx(
  id: string,
  overrides: Partial<ReorderGestureContext> = {}
): ReorderGestureContext {
  const start = { x: 50, y: 50 }
  return {
    groupId: "g1",
    memberId: id,
    memberKind: "iframe-layer",
    groupX: 0,
    gap: 20,
    grabOffset: { x: 10, y: 10 },
    startCanvas: start,
    startShiftKey: false,
    selectOnNoMove: false,
    ...overrides,
  }
}

describe("reduceGesture — reorder", () => {
  it("starts from idle: snapshots order and previews the in-flow drag", () => {
    const ctx = reorderCtx("a")
    const result = reduceGesture(
      { kind: "idle" },
      {
        type: "start",
        start: { kind: "reorder", ctx, order: reorderOrder, meta: false },
      }
    )

    expect(result.state).toEqual({
      kind: "reorder",
      ctx,
      order: reorderOrder,
      cursor: ctx.startCanvas,
      popped: false,
    })
    expect(result.preview.reorder).toEqual({
      memberId: "a",
      cursor: ctx.startCanvas,
      grabOffset: ctx.grabOffset,
      popped: false,
    })
    expect(result.preview.gapOverride).toBeNull()
    expect(result.intent).toBeUndefined()
  })

  it("emits reorderMember when the cursor crosses a sibling center", () => {
    // Dragging "a" right past b's center (170) and before c's center (290)
    // lands it at index 1: [b, a, c].
    const ctx = reorderCtx("a")
    const result = run([
      {
        type: "start",
        start: { kind: "reorder", ctx, order: reorderOrder, meta: false },
      },
      { type: "move", cursor: { x: 200, y: 50 }, meta: false },
    ])

    expect(result.intent).toEqual({
      type: "reorderMember",
      groupId: "g1",
      members: [
        { kind: "iframe-layer", id: "b" },
        { kind: "iframe-layer", id: "a" },
        { kind: "iframe-layer", id: "c" },
      ],
    })
    expect(result.preview.reorder).toEqual({
      memberId: "a",
      cursor: { x: 200, y: 50 },
      grabOffset: ctx.grabOffset,
      popped: false,
    })
  })

  it("emits no intent when the drop index is unchanged", () => {
    // "a" stays left of b's center (170), so it remains at index 0.
    const result = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a"),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "move", cursor: { x: 60, y: 50 }, meta: false },
    ])

    expect(result.intent).toBeUndefined()
  })

  it("previews the pop-out while meta is held and emits no reorder", () => {
    const ctx = reorderCtx("a")
    const result = run([
      {
        type: "start",
        start: { kind: "reorder", ctx, order: reorderOrder, meta: false },
      },
      { type: "move", cursor: { x: 200, y: 50 }, meta: true },
    ])

    expect(result.intent).toBeUndefined()
    expect(result.preview.reorder?.popped).toBe(true)
    // Order stays frozen while popped (no in-flow reindex).
    expect(result.state).toMatchObject({ kind: "reorder", order: reorderOrder })
  })

  it("flips the pop-out preview on a meta press with no pointer move", () => {
    const result = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a"),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "metaChange", meta: true },
    ])

    expect(result.preview.reorder?.popped).toBe(true)
    expect(result.intent).toBeUndefined()
  })

  it("commits popOutToNewGroup on release while meta is held", () => {
    // Pop "a" out and release at (200, 80); the new group anchors at
    // cursor - grabOffset = (190, 70).
    const result = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a"),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "move", cursor: { x: 200, y: 80 }, meta: true },
      { type: "release", cursor: { x: 200, y: 80 }, meta: true },
    ])

    expect(result.intent).toEqual({
      type: "popOutToNewGroup",
      memberId: "a",
      x: 190,
      y: 70,
    })
    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
  })

  it("selects on a no-move release from a label, not from a dot", () => {
    const fromLabel = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a", { selectOnNoMove: true, startShiftKey: true }),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "release", cursor: { x: 50, y: 50 } },
    ])
    expect(fromLabel.intent).toEqual({
      type: "selectMember",
      memberId: "a",
      kind: "iframe-layer",
      additive: true,
    })

    const fromDot = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a"),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "release", cursor: { x: 50, y: 50 } },
    ])
    expect(fromDot.intent).toBeUndefined()
  })

  it("does not select on a release that moved past the click slop", () => {
    const result = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a", { selectOnNoMove: true }),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "move", cursor: { x: 60, y: 50 }, meta: false },
      { type: "release", cursor: { x: 60, y: 50 } },
    ])
    // Moved < a sibling-center crossing but > slop: no select, no reorder.
    expect(result.intent).toBeUndefined()
  })

  it("resumes in-flow reorder after meta is released mid-drag", () => {
    // Pop out, then drop meta and move past b's center: reindex resumes.
    const result = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a"),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "move", cursor: { x: 200, y: 80 }, meta: true },
      { type: "metaChange", meta: false },
      { type: "move", cursor: { x: 200, y: 50 }, meta: false },
    ])

    expect(result.preview.reorder?.popped).toBe(false)
    expect(result.intent).toEqual({
      type: "reorderMember",
      groupId: "g1",
      members: [
        { kind: "iframe-layer", id: "b" },
        { kind: "iframe-layer", id: "a" },
        { kind: "iframe-layer", id: "c" },
      ],
    })
  })

  it("cancels a reorder back to idle with no intent", () => {
    const result = run([
      {
        type: "start",
        start: {
          kind: "reorder",
          ctx: reorderCtx("a"),
          order: reorderOrder,
          meta: false,
        },
      },
      { type: "move", cursor: { x: 200, y: 50 }, meta: false },
      { type: "cancel" },
    ])

    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
    expect(result.intent).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Group-move + move-snap + merge-snap (#543). The move arm orchestrates the
// pure Snap functions, so the fixtures below pin observable behavior — the
// `moveBy` deltas, the Snap Guides, and the merge commit — against plain
// values, with no React, DOM, or Y.Doc. The Snap math itself is covered by
// `snap.test.ts`; these assert the orchestration around it.

/**
 * Replay an event sequence from `idle`, returning the result *after each* event
 * so a test can inspect the intermediate `moveBy` deltas and guides (the
 * sticky-snap behavior only shows up move-by-move, not in the final state).
 */
function steps(events: GestureEvent[]): GestureResult[] {
  let state: GestureState = { kind: "idle" }
  const out: GestureResult[] = []
  for (const event of events) {
    const result = reduceGesture(state, event)
    state = result.state
    out.push(result)
  }
  return out
}

describe("reduceGesture — group-move (no snap, no merge)", () => {
  const ctx: MoveGestureContext = {
    moveMemberIds: ["a"],
    sourceGroupId: null,
    sourceStart: null,
    snap: null,
    merge: null,
    zoom: 1,
  }

  it("seeds an idle preview on start: no guides, no merge, no intent", () => {
    const result = reduceGesture(
      { kind: "idle" },
      { type: "start", start: { kind: "move", ctx } }
    )

    expect(result.state.kind).toBe("move")
    expect(result.preview).toEqual({
      gapOverride: null,
      reorder: null,
      snapGuides: [],
      mergeRects: null,
      marqueeRect: null,
    })
    expect(result.intent).toBeUndefined()
  })

  it("emits moveBy with the raw incremental delta on each move", () => {
    const [, m1, m2] = steps([
      { type: "start", start: { kind: "move", ctx } },
      { type: "move", cursor: { x: 10, y: 5 } },
      { type: "move", cursor: { x: 25, y: 5 } },
    ])

    // First move: full cumulative delta. Second: only the increment (15, 0).
    expect(m1.intent).toEqual({
      type: "moveBy",
      memberIds: ["a"],
      dx: 10,
      dy: 5,
    })
    expect(m2.intent).toEqual({
      type: "moveBy",
      memberIds: ["a"],
      dx: 15,
      dy: 0,
    })
    expect(m2.preview).toEqual({
      gapOverride: null,
      reorder: null,
      snapGuides: [],
      mergeRects: null,
      marqueeRect: null,
    })
  })

  it("commits nothing on release when there is no merge target", () => {
    const all = steps([
      { type: "start", start: { kind: "move", ctx } },
      { type: "move", cursor: { x: 10, y: 5 } },
      { type: "release" },
    ])
    const release = all[all.length - 1]

    expect(release.intent).toBeUndefined()
    expect(release.state).toEqual({ kind: "idle" })
    expect(release.preview).toEqual(EMPTY_PREVIEW)
  })

  it("emits no moveBy when nothing moves (empty member set)", () => {
    const [, m1] = steps([
      {
        type: "start",
        start: { kind: "move", ctx: { ...ctx, moveMemberIds: [] } },
      },
      { type: "move", cursor: { x: 10, y: 0 } },
    ])
    expect(m1.intent).toBeUndefined()
  })
})

describe("reduceGesture — group-move sticky edge-snap", () => {
  // A 100×100 moving union with one stationary candidate to its right whose
  // left edge sits at world x=120 (top-aligned so only the x-axis snaps). The
  // dragged union's right edge snaps to that edge within 8 screen px (zoom 1).
  const ctx: MoveGestureContext = {
    moveMemberIds: ["a"],
    sourceGroupId: null,
    sourceStart: null,
    snap: {
      startUnion: { x: 0, y: 0, width: 100, height: 100 },
      candidates: [{ x: 120, y: 200, width: 100, height: 100 }],
    },
    merge: null,
    zoom: 1,
  }

  it("holds the guide while the cursor keeps moving, then unlocks past threshold", () => {
    const [, before, lock, hold, unlock] = steps([
      { type: "start", start: { kind: "move", ctx } },
      // Right edge at 110, still 10px from the guide at 120 → no snap yet.
      { type: "move", cursor: { x: 10, y: 0 } },
      // Right edge at 115, 5px away → snaps: the union jumps the full 10px so
      // its right edge lands on 120 (cursor moved 5, world moved 10).
      { type: "move", cursor: { x: 15, y: 0 } },
      // Cursor creeps to 118 (raw right 118, 2px from guide): the rect *sticks*
      // — the snap absorbs the 3px of cursor travel, so the world doesn't move.
      { type: "move", cursor: { x: 18, y: 0 } },
      // Cursor jumps to 30 (raw right 130, 10px past the guide): lock releases
      // and the rect pops back to follow the cursor.
      { type: "move", cursor: { x: 30, y: 0 } },
    ])

    // Before the guide is reached: raw movement, no guides.
    expect(before.intent).toMatchObject({ type: "moveBy", dx: 10 })
    expect(before.preview.snapGuides).toHaveLength(0)

    // Locking on: the world jumps 10px (5 cursor + 5 snap) and a guide appears.
    expect(lock.intent).toMatchObject({ type: "moveBy", dx: 10 })
    expect(lock.preview.snapGuides.length).toBeGreaterThan(0)

    // Sticky hold: cursor moved 3px but the snap absorbs it → world delta 0.
    expect(hold.intent).toMatchObject({ type: "moveBy", dx: 0 })
    expect(hold.preview.snapGuides.length).toBeGreaterThan(0)

    // Past threshold: the lock releases (snap was +2, so 12 cursor − 2 = 10).
    expect(unlock.intent).toMatchObject({ type: "moveBy", dx: 10 })
    expect(unlock.preview.snapGuides).toHaveLength(0)
  })

  it("bypasses the snap and releases the lock when meta is held", () => {
    const [, lock, freed] = steps([
      { type: "start", start: { kind: "move", ctx } },
      { type: "move", cursor: { x: 15, y: 0 } },
      // Same cursor position, now with cmd held: the lock releases (the +5 snap
      // is undone) and no guides are drawn.
      { type: "move", cursor: { x: 15, y: 0 }, meta: true },
    ])

    // Straight to cursor 15 from rest: 15 cursor travel + 5 snap = 20.
    expect(lock.intent).toMatchObject({ type: "moveBy", dx: 20 })
    expect(lock.preview.snapGuides.length).toBeGreaterThan(0)
    // dx = 0 (cursor unchanged) − 5 (applied snap undone) = −5.
    expect(freed.intent).toMatchObject({ type: "moveBy", dx: -5 })
    expect(freed.preview.snapGuides).toHaveLength(0)
  })
})

describe("reduceGesture — group-move merge (commit on release)", () => {
  // Source group at the origin, 100×100, one 100×100 member. One merge target
  // whose trailing "+ frame" slot sits at x = 200 + 100 + gap(20) = 320, y = 0.
  // The source goes hot when its top-left lands within 16 screen px of (320, 0).
  const ctx: MoveGestureContext = {
    moveMemberIds: ["m"],
    sourceGroupId: "s",
    sourceStart: { x: 0, y: 0 },
    snap: null,
    merge: {
      sourceContentW: 100,
      sourceContentH: 100,
      memberSizes: [{ width: 100, height: 100 }],
      candidates: [
        { id: "t", rect: { x: 200, y: 0, width: 100, height: 100 }, gap: 20 },
      ],
    },
    zoom: 1,
  }

  it("previews the merged row while hot and commits mergeGroups only on release", () => {
    const [start, cold, hot, release] = steps([
      { type: "start", start: { kind: "move", ctx } },
      // Drag partway — still 120px from the slot: not hot.
      { type: "move", cursor: { x: 200, y: 0 } },
      // Drag onto the slot: top-left at (320, 0), exactly on target → hot.
      { type: "move", cursor: { x: 320, y: 0 } },
      { type: "release" },
    ])

    expect(start.preview.mergeRects).toBeNull()
    expect(cold.preview.mergeRects).toBeNull()

    // Hot: the preview lays out one rect per source member at the merged slot,
    // and no intent has merged yet — only the live moveBy.
    expect(hot.preview.mergeRects).toEqual([
      { x: 320, y: 0, width: 100, height: 100 },
    ])
    // The move is live: dx is the increment from the previous cursor (200→320).
    expect(hot.intent).toMatchObject({ type: "moveBy", dx: 120 })
    if (hot.state.kind !== "move") throw new Error("expected move state")
    expect(hot.state.targetId).toBe("t")

    // Release commits the merge and clears the preview.
    expect(release.intent).toEqual({
      type: "mergeGroups",
      sourceId: "s",
      targetId: "t",
    })
    expect(release.state).toEqual({ kind: "idle" })
    expect(release.preview).toEqual(EMPTY_PREVIEW)
  })

  it("does not merge on release when meta is held (drop freely)", () => {
    const all = steps([
      { type: "start", start: { kind: "move", ctx } },
      { type: "move", cursor: { x: 320, y: 0 } },
      { type: "release", meta: true },
    ])
    const release = all[all.length - 1]

    expect(release.intent).toBeUndefined()
    expect(release.state).toEqual({ kind: "idle" })
  })

  it("flips the merge preview the instant meta is pressed or released (no move)", () => {
    const [, hot, suppressed, restored] = steps([
      { type: "start", start: { kind: "move", ctx } },
      { type: "move", cursor: { x: 320, y: 0 } },
      // cmd pressed mid-hover: the merge preview drops without any pointer move.
      { type: "metaChange", meta: true },
      // cmd released: the preview comes back.
      { type: "metaChange", meta: false },
    ])

    expect(hot.preview.mergeRects).not.toBeNull()
    expect(suppressed.preview.mergeRects).toBeNull()
    if (suppressed.state.kind !== "move") throw new Error("expected move state")
    expect(suppressed.state.targetId).toBeNull()
    // A `metaChange` event never moves anything.
    expect(suppressed.intent).toBeUndefined()

    expect(restored.preview.mergeRects).not.toBeNull()
    if (restored.state.kind !== "move") throw new Error("expected move state")
    expect(restored.state.targetId).toBe("t")
  })

  it("suppresses the hot target while meta is held during a move", () => {
    const [, hot] = steps([
      { type: "start", start: { kind: "move", ctx } },
      { type: "move", cursor: { x: 320, y: 0 }, meta: true },
    ])

    expect(hot.preview.mergeRects).toBeNull()
    if (hot.state.kind !== "move") throw new Error("expected move state")
    expect(hot.state.targetId).toBeNull()
  })
})

// Marquee is the selection-only gesture: its Intent (`marqueeSelect`) is applied
// to local selection state, never a Canvas Operation. The reducer owns the
// selection algebra (replace vs shift-toggle) over the hit ids the component
// passes in; the geometry hit-test that produces those ids stays in the
// component, so the fixtures here are plain id sets — no layouts, no DOM.

const marqueeCtx: MarqueeGestureContext = {
  startX: 100,
  startY: 100,
  shiftKey: false,
  baseIframeLayerIds: new Set(),
  baseDocumentLayerIds: new Set(),
}

describe("reduceGesture — marquee selection", () => {
  it("opens from idle: previews the degenerate rect and clears the selection", () => {
    const result = reduceGesture(
      { kind: "idle" },
      { type: "start", start: { kind: "marquee", ctx: marqueeCtx } }
    )

    expect(result.state).toEqual({
      kind: "marquee",
      ctx: marqueeCtx,
      cursor: { x: 100, y: 100 },
    })
    // The drag rect surfaces via the Preview (drawn by the SelectionOverlay) and
    // pointedly leaves the geometry slices null — it does not feed
    // `deriveCanvasLayout`.
    expect(result.preview).toEqual({
      gapOverride: null,
      reorder: null,
      snapGuides: [],
      mergeRects: null,
      marqueeRect: { startX: 100, startY: 100, currentX: 100, currentY: 100 },
    })
    // Opening a non-shift marquee clears the layer selection.
    expect(result.intent).toEqual({
      type: "marqueeSelect",
      iframeLayerIds: new Set(),
      documentLayerIds: new Set(),
    })
  })

  it("opens a shift-marquee against the base selection rather than clearing it", () => {
    const ctx: MarqueeGestureContext = {
      ...marqueeCtx,
      shiftKey: true,
      baseIframeLayerIds: new Set(["a"]),
      baseDocumentLayerIds: new Set(["d"]),
    }
    const result = reduceGesture(
      { kind: "idle" },
      { type: "start", start: { kind: "marquee", ctx } }
    )

    expect(result.intent).toEqual({
      type: "marqueeSelect",
      iframeLayerIds: new Set(["a"]),
      documentLayerIds: new Set(["d"]),
    })
  })

  it("replaces the selection with the live hits on move (no shift)", () => {
    const result = run([
      { type: "start", start: { kind: "marquee", ctx: marqueeCtx } },
      {
        type: "move",
        cursor: { x: 200, y: 180 },
        hits: {
          iframeLayerIds: new Set(["a", "b"]),
          documentLayerIds: new Set(["d"]),
        },
      },
    ])

    expect(result.preview.marqueeRect).toEqual({
      startX: 100,
      startY: 100,
      currentX: 200,
      currentY: 180,
    })
    expect(result.intent).toEqual({
      type: "marqueeSelect",
      iframeLayerIds: new Set(["a", "b"]),
      documentLayerIds: new Set(["d"]),
    })
  })

  it("toggles hits against the frozen base under shift", () => {
    const ctx: MarqueeGestureContext = {
      ...marqueeCtx,
      shiftKey: true,
      baseIframeLayerIds: new Set(["a", "b"]),
      baseDocumentLayerIds: new Set(["d"]),
    }
    const result = run([
      { type: "start", start: { kind: "marquee", ctx } },
      {
        type: "move",
        cursor: { x: 200, y: 180 },
        // `b` is already in the base → removed; `c` is new → added; `d` toggled out.
        hits: {
          iframeLayerIds: new Set(["b", "c"]),
          documentLayerIds: new Set(["d"]),
        },
      },
    ])

    expect(result.intent).toEqual({
      type: "marqueeSelect",
      iframeLayerIds: new Set(["a", "c"]),
      documentLayerIds: new Set(),
    })
  })

  it("toggles against the base, not the prior move (stable baseline)", () => {
    const ctx: MarqueeGestureContext = {
      ...marqueeCtx,
      shiftKey: true,
      baseIframeLayerIds: new Set(["a"]),
    }
    const result = run([
      { type: "start", start: { kind: "marquee", ctx } },
      {
        type: "move",
        cursor: { x: 150, y: 150 },
        hits: { iframeLayerIds: new Set(["b"]), documentLayerIds: new Set() },
      },
      {
        type: "move",
        cursor: { x: 160, y: 160 },
        hits: { iframeLayerIds: new Set(["c"]), documentLayerIds: new Set() },
      },
    ])

    // Second move toggles {c} against the base {a} — not against the {a,b} the
    // first move produced. So `b` is gone, not retained.
    expect(result.intent).toEqual({
      type: "marqueeSelect",
      iframeLayerIds: new Set(["a", "c"]),
      documentLayerIds: new Set(),
    })
  })

  it("keeps the drag's selection on release of a real marquee (no intent)", () => {
    const result = run([
      { type: "start", start: { kind: "marquee", ctx: marqueeCtx } },
      {
        type: "move",
        cursor: { x: 200, y: 200 },
        hits: { iframeLayerIds: new Set(["a"]), documentLayerIds: new Set() },
      },
      { type: "release" },
    ])

    // The move already settled the selection; release just resets to rest.
    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
    expect(result.intent).toBeUndefined()
  })

  it("treats a sub-threshold drag as a click and deselects on release", () => {
    const result = run([
      { type: "start", start: { kind: "marquee", ctx: marqueeCtx } },
      {
        type: "move",
        cursor: { x: 101, y: 102 },
        hits: { iframeLayerIds: new Set(["a"]), documentLayerIds: new Set() },
      },
      { type: "release" },
    ])

    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
    expect(result.intent).toEqual({
      type: "marqueeSelect",
      iframeLayerIds: new Set(),
      documentLayerIds: new Set(),
    })
  })

  it("does not deselect on a tiny shift-click (keeps the settled selection)", () => {
    const ctx: MarqueeGestureContext = {
      ...marqueeCtx,
      shiftKey: true,
      baseIframeLayerIds: new Set(["a"]),
    }
    const result = run([
      { type: "start", start: { kind: "marquee", ctx } },
      { type: "release" },
    ])

    // Tiny drag + shift → no deselect intent; the base selection stands.
    expect(result.state).toEqual({ kind: "idle" })
    expect(result.intent).toBeUndefined()
  })

  it("cancels a marquee back to idle with no intent", () => {
    const result = run([
      { type: "start", start: { kind: "marquee", ctx: marqueeCtx } },
      {
        type: "move",
        cursor: { x: 200, y: 200 },
        hits: { iframeLayerIds: new Set(["a"]), documentLayerIds: new Set() },
      },
      { type: "cancel" },
    ])

    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
    expect(result.intent).toBeUndefined()
  })
})
