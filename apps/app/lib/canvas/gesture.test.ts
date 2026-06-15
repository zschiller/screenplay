import { describe, expect, it } from "vitest"
import {
  EMPTY_PREVIEW,
  reduceGesture,
  type GapGestureContext,
  type GestureEvent,
  type GestureResult,
  type GestureState,
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
    expect(result.preview).toEqual({ gapOverride: { groupId: "g1", gap: 50 } })
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
    expect(result.preview).toEqual({ gapOverride: { groupId: "g1", gap: 90 } })
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
    expect(result.preview).toEqual({ gapOverride: { groupId: "g2", gap: 30 } })
  })
})
