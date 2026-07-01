import { describe, expect, it } from "vitest"

import { eligibleTargetFrames } from "@/lib/canvas/element-targeting"
import type { IframeLayerData } from "@/lib/types"

// Plain fixtures — no React. `eligibleTargetFrames` is pure: a composer branch
// id + the room's iframe layers in, the targetable subset out. These pin that
// eligibility is exactly branch identity (a frame is targetable iff its
// `branchId` equals the composer's branch), mirroring the `reduceToolMode` /
// `reconcileInteractionMode` predicate-test prior art.

// Minimal frame fixture — only the fields the predicate reads matter; the rest
// are filled to satisfy the type.
function frame(id: string, branchId?: string): IframeLayerData {
  return {
    id,
    branchId,
    width: 390,
    height: 844,
    label: `Frame ${id}`,
    iframeState: {},
  }
}

describe("eligibleTargetFrames", () => {
  it("returns exactly the frames whose branchId matches the composer branch", () => {
    const frames = [frame("a", "branch-1"), frame("b", "branch-2")]
    expect(eligibleTargetFrames("branch-1", frames)).toEqual([frames[0]])
  })

  it("returns every matching frame when a branch owns several", () => {
    const frames = [
      frame("a", "branch-1"),
      frame("b", "branch-1"),
      frame("c", "branch-2"),
    ]
    expect(eligibleTargetFrames("branch-1", frames)).toEqual([
      frames[0],
      frames[1],
    ])
  })

  it("is empty when no frame belongs to the composer branch", () => {
    const frames = [frame("a", "branch-2"), frame("b", "branch-3")]
    expect(eligibleTargetFrames("branch-1", frames)).toEqual([])
  })

  it("is empty for an empty frame list", () => {
    expect(eligibleTargetFrames("branch-1", [])).toEqual([])
  })

  it("never matches a frame with no branchId, even against an undefined branch", () => {
    const frames = [frame("a"), frame("b", "branch-1")]
    // An empty frame (no branchId) is not targetable...
    expect(eligibleTargetFrames("branch-1", frames)).toEqual([frames[1]])
    // ...and a composer with no bound branch targets nothing at all, rather
    // than every empty frame via `undefined === undefined`.
    expect(eligibleTargetFrames(undefined, frames)).toEqual([])
  })
})
