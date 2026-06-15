import { describe, expect, it } from "vitest"
import {
  EMPTY_PREVIEW,
  reduceGesture,
  type GapGestureContext,
  type GestureEvent,
  type GestureResult,
  type GestureState,
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
      { type: "start", start: { kind: "reorder", ctx, order: reorderOrder, meta: false } }
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
      { type: "start", start: { kind: "reorder", ctx, order: reorderOrder, meta: false } },
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
      { type: "start", start: { kind: "reorder", ctx: reorderCtx("a"), order: reorderOrder, meta: false } },
      { type: "move", cursor: { x: 60, y: 50 }, meta: false },
    ])

    expect(result.intent).toBeUndefined()
  })

  it("previews the pop-out while meta is held and emits no reorder", () => {
    const ctx = reorderCtx("a")
    const result = run([
      { type: "start", start: { kind: "reorder", ctx, order: reorderOrder, meta: false } },
      { type: "move", cursor: { x: 200, y: 50 }, meta: true },
    ])

    expect(result.intent).toBeUndefined()
    expect(result.preview.reorder?.popped).toBe(true)
    // Order stays frozen while popped (no in-flow reindex).
    expect(result.state).toMatchObject({ kind: "reorder", order: reorderOrder })
  })

  it("flips the pop-out preview on a meta press with no pointer move", () => {
    const result = run([
      { type: "start", start: { kind: "reorder", ctx: reorderCtx("a"), order: reorderOrder, meta: false } },
      { type: "metaChange", meta: true },
    ])

    expect(result.preview.reorder?.popped).toBe(true)
    expect(result.intent).toBeUndefined()
  })

  it("commits popOutToNewGroup on release while meta is held", () => {
    // Pop "a" out and release at (200, 80); the new group anchors at
    // cursor - grabOffset = (190, 70).
    const result = run([
      { type: "start", start: { kind: "reorder", ctx: reorderCtx("a"), order: reorderOrder, meta: false } },
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
      { type: "start", start: { kind: "reorder", ctx: reorderCtx("a"), order: reorderOrder, meta: false } },
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
      { type: "start", start: { kind: "reorder", ctx: reorderCtx("a"), order: reorderOrder, meta: false } },
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
      { type: "start", start: { kind: "reorder", ctx: reorderCtx("a"), order: reorderOrder, meta: false } },
      { type: "move", cursor: { x: 200, y: 50 }, meta: false },
      { type: "cancel" },
    ])

    expect(result.state).toEqual({ kind: "idle" })
    expect(result.preview).toEqual(EMPTY_PREVIEW)
    expect(result.intent).toBeUndefined()
  })
})
