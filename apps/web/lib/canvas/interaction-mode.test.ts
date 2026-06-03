import { describe, expect, it } from "vitest"

import { reconcileInteractionMode } from "@/lib/canvas/interaction-mode"

describe("reconcileInteractionMode", () => {
  it("clears a dangling focused id to null", () => {
    expect(
      reconcileInteractionMode({
        focusedId: "gone",
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("clears a dangling Create Flow id to null", () => {
    expect(
      reconcileInteractionMode({
        focusedId: null,
        createFlowId: "gone",
        existingLayerIds: new Set(["a", "b"]),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("passes present ids through unchanged", () => {
    expect(
      reconcileInteractionMode({
        focusedId: "a",
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
      })
    ).toEqual({ focusedId: "a", createFlowId: null })
  })

  it("passes already-null inputs through unchanged", () => {
    expect(
      reconcileInteractionMode({
        focusedId: null,
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("leaves an active id untouched when an unrelated layer is deleted", () => {
    // "b" was removed; the focused frame "a" still exists, so it stays active.
    expect(
      reconcileInteractionMode({
        focusedId: "a",
        createFlowId: null,
        existingLayerIds: new Set(["a"]),
      })
    ).toEqual({ focusedId: "a", createFlowId: null })
  })

  it("clears only the mode whose frame is gone", () => {
    // Modes are mutually exclusive in practice, but the reconciler treats each
    // id independently: a present id survives even if the other is dangling.
    expect(
      reconcileInteractionMode({
        focusedId: "a",
        createFlowId: "gone",
        existingLayerIds: new Set(["a"]),
      })
    ).toEqual({ focusedId: "a", createFlowId: null })
  })
})
