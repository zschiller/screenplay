import { describe, expect, it } from "vitest"
import { appendPosition, densePositions } from "@/lib/pin-order"

describe("appendPosition", () => {
  it("starts a fresh list at 0", () => {
    expect(appendPosition([])).toBe(0)
  })

  it("appends one past the current maximum", () => {
    expect(appendPosition([0, 1, 2])).toBe(3)
  })

  it("appends past the real maximum even when the list has gaps", () => {
    // After an unpin the positions can be sparse; a new pin still lands past the
    // highest, never colliding with a surviving one.
    expect(appendPosition([0, 2, 5])).toBe(6)
  })

  it("does not mutate the input", () => {
    const positions = [0, 1, 2]
    appendPosition(positions)
    expect(positions).toEqual([0, 1, 2])
  })
})

describe("densePositions", () => {
  it("assigns contiguous 0-based positions in order", () => {
    expect(densePositions(["a", "b", "c"])).toEqual([
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ])
  })

  it("collapses gaps from a reordered/pruned list", () => {
    // A list that lost its middle pin and was reordered: the survivors re-pack
    // into a gapless 0..n-1 run regardless of their prior positions.
    expect(densePositions(["c", "a"])).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 1 },
    ])
  })

  it("returns an empty list unchanged", () => {
    expect(densePositions([])).toEqual([])
  })

  it("does not mutate the input", () => {
    const ids = ["a", "b"]
    densePositions(ids)
    expect(ids).toEqual(["a", "b"])
  })
})
