import { describe, expect, it } from "vitest"

import {
  shouldMoveSelection,
  shouldSelectOnPointerDown,
} from "@/lib/canvas/layer-shell"

describe("shouldMoveSelection", () => {
  it("moves the selection when the layer itself is selected", () => {
    expect(shouldMoveSelection({ selected: true, groupSelected: false })).toBe(
      true
    )
  })

  it("moves the selection when the parent group is selected", () => {
    expect(shouldMoveSelection({ selected: false, groupSelected: true })).toBe(
      true
    )
  })

  it("moves just the group when neither is selected", () => {
    expect(shouldMoveSelection({ selected: false, groupSelected: false })).toBe(
      false
    )
  })
})

describe("shouldSelectOnPointerDown", () => {
  it("selects on a plain press when nothing here is selected", () => {
    expect(
      shouldSelectOnPointerDown({
        selected: false,
        groupSelected: false,
        shiftKey: false,
      })
    ).toBe(true)
  })

  it("does not re-select when the layer is already the sole selection", () => {
    expect(
      shouldSelectOnPointerDown({
        selected: true,
        groupSelected: false,
        shiftKey: false,
      })
    ).toBe(false)
  })

  it("still toggles an already-selected layer on a shift-press", () => {
    expect(
      shouldSelectOnPointerDown({
        selected: true,
        groupSelected: false,
        shiftKey: true,
      })
    ).toBe(true)
  })

  it("leaves selection on the parent group for a plain press", () => {
    expect(
      shouldSelectOnPointerDown({
        selected: false,
        groupSelected: true,
        shiftKey: false,
      })
    ).toBe(false)
  })

  it("drills through to additively pick a member on a shift-press while the group is selected", () => {
    expect(
      shouldSelectOnPointerDown({
        selected: false,
        groupSelected: true,
        shiftKey: true,
      })
    ).toBe(true)
  })
})
