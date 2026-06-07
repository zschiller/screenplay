import { describe, expect, it } from "vitest"

import { reconcileInteractionMode } from "@/lib/canvas/interaction-mode"

describe("reconcileInteractionMode", () => {
  it("clears a dangling focused id to null", () => {
    expect(
      reconcileInteractionMode({
        focusedId: "gone",
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
        selectedLayerIds: new Set(["gone"]),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("clears a dangling Create Flow id to null", () => {
    expect(
      reconcileInteractionMode({
        focusedId: null,
        createFlowId: "gone",
        existingLayerIds: new Set(["a", "b"]),
        selectedLayerIds: new Set(["gone"]),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("passes present, selected ids through unchanged", () => {
    expect(
      reconcileInteractionMode({
        focusedId: "a",
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
        selectedLayerIds: new Set(["a"]),
      })
    ).toEqual({ focusedId: "a", createFlowId: null })
  })

  it("passes already-null inputs through unchanged", () => {
    expect(
      reconcileInteractionMode({
        focusedId: null,
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
        selectedLayerIds: new Set<string>(),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("leaves an active id untouched when an unrelated layer is deleted", () => {
    // "b" was removed; the focused frame "a" still exists and is selected, so
    // it stays active.
    expect(
      reconcileInteractionMode({
        focusedId: "a",
        createFlowId: null,
        existingLayerIds: new Set(["a"]),
        selectedLayerIds: new Set(["a"]),
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
        selectedLayerIds: new Set(["a"]),
      })
    ).toEqual({ focusedId: "a", createFlowId: null })
  })

  it("clears a focused id whose frame was deselected", () => {
    // The frame still exists but is no longer selected — deselecting exits the
    // mode just like deleting the frame would.
    expect(
      reconcileInteractionMode({
        focusedId: "a",
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
        selectedLayerIds: new Set(["b"]),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("clears a Create Flow id whose frame was deselected", () => {
    expect(
      reconcileInteractionMode({
        focusedId: null,
        createFlowId: "a",
        existingLayerIds: new Set(["a", "b"]),
        selectedLayerIds: new Set<string>(),
      })
    ).toEqual({ focusedId: null, createFlowId: null })
  })

  it("keeps an active id selected as part of a multi-selection", () => {
    // The focused frame can be one of several selected frames; as long as it
    // remains in the selection set, its mode survives.
    expect(
      reconcileInteractionMode({
        focusedId: "a",
        createFlowId: null,
        existingLayerIds: new Set(["a", "b"]),
        selectedLayerIds: new Set(["a", "b"]),
      })
    ).toEqual({ focusedId: "a", createFlowId: null })
  })
})
