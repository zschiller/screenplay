import { describe, expect, it } from "vitest"
import {
  BRANCH_COLORS,
  IDENTITY_COLOR_INDICES,
  getBranchColor,
  resolveBranchColorIndex,
} from "./branch-colors"

const STATUS_HUES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "rose",
]

describe("branch identity colors", () => {
  it("never offers a status hue", () => {
    const names = IDENTITY_COLOR_INDICES.map((i) => BRANCH_COLORS[i]!.name)
    for (const hue of STATUS_HUES) expect(names).not.toContain(hue)
    expect(names.length).toBeGreaterThan(0)
  })

  it("never hashes a key onto a status hue", () => {
    for (let n = 0; n < 500; n++) {
      expect(getBranchColor(`branch-${n}`).status).toBeUndefined()
    }
  })

  it("keeps a stored identity override and its index", () => {
    const blue = BRANCH_COLORS.findIndex((c) => c.name === "blue")
    expect(resolveBranchColorIndex("any", blue)).toBe(blue)
  })

  it("falls back to the hash for a stored status-hue override", () => {
    const red = BRANCH_COLORS.findIndex((c) => c.name === "red")
    expect(resolveBranchColorIndex("any", red)).toBe(
      resolveBranchColorIndex("any")
    )
  })
})
