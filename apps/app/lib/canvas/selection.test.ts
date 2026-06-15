import { describe, expect, it } from "vitest"

import {
  expandSelectedGroups,
  groupSelectedMemberIds,
  nextIframeLayerAfterDelete,
  overlaySelectedIds,
  resolveSelectionDelete,
  toggleSelection,
  type SelectionGroupSnapshot,
  type SelectionSnapshot,
} from "@/lib/canvas/selection"

// Plain fixtures — no React, no Y.Doc. These pin the selection decisions
// (cascade, delete resolution + next-neighbor, shift-toggle, and the overlay /
// group projections) against plain Sets and member lists, the same way the
// other lib/canvas pure cores (layout, snap, escape) are tested.

function snapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    iframeLayerIds: new Set(),
    groupIds: new Set(),
    markdownLayerIds: new Set(),
    ...overrides,
  }
}

/** A two-frame group "g1" and a mixed group "g2" (frame + doc). */
function groups(): SelectionGroupSnapshot[] {
  return [
    {
      id: "g1",
      members: [
        { kind: "iframe-layer", id: "a1" },
        { kind: "iframe-layer", id: "a2" },
        { kind: "iframe-layer", id: "a3" },
      ],
    },
    {
      id: "g2",
      members: [
        { kind: "iframe-layer", id: "b1" },
        { kind: "markdown-layer", id: "d1" },
      ],
    },
  ]
}

describe("expandSelectedGroups — cascade across kinds", () => {
  it("includes both kinds of a selected group's members alongside direct selections", () => {
    const { iframeLayerIds, markdownLayerIds } = expandSelectedGroups(
      snapshot({
        iframeLayerIds: new Set(["a2"]),
        groupIds: new Set(["g2"]),
        markdownLayerIds: new Set(["d9"]),
      }),
      groups()
    )

    expect([...iframeLayerIds].sort()).toEqual(["a2", "b1"])
    expect([...markdownLayerIds].sort()).toEqual(["d1", "d9"])
  })

  it("returns only direct selections when no group is selected", () => {
    const { iframeLayerIds, markdownLayerIds } = expandSelectedGroups(
      snapshot({ iframeLayerIds: new Set(["a1"]) }),
      groups()
    )

    expect([...iframeLayerIds]).toEqual(["a1"])
    expect([...markdownLayerIds]).toEqual([])
  })
})

describe("nextIframeLayerAfterDelete — neighbor rule", () => {
  it("prefers the right neighbor", () => {
    expect(nextIframeLayerAfterDelete("a2", groups())).toBe("a3")
  })

  it("falls back to the left neighbor when deleting the last frame", () => {
    expect(nextIframeLayerAfterDelete("a3", groups())).toBe("a2")
  })

  it("returns null for a lone frame (skips doc members)", () => {
    expect(nextIframeLayerAfterDelete("b1", groups())).toBeNull()
  })

  it("returns null when the frame isn't found", () => {
    expect(nextIframeLayerAfterDelete("nope", groups())).toBeNull()
  })
})

describe("resolveSelectionDelete", () => {
  it("keeps selection on the right neighbor for a single-frame delete", () => {
    const result = resolveSelectionDelete(
      snapshot({ iframeLayerIds: new Set(["a1"]) }),
      groups()
    )

    expect(result.removeIframeLayerIds).toEqual(["a1"])
    expect(result.removeMarkdownLayerIds).toEqual([])
    expect([...result.nextSelection.iframeLayerIds]).toEqual(["a2"])
    expect(result.nextSelection.groupIds.size).toBe(0)
    expect(result.hasRemovals).toBe(true)
  })

  it("clears selection for a multi-frame delete", () => {
    const result = resolveSelectionDelete(
      snapshot({ iframeLayerIds: new Set(["a1", "a2"]) }),
      groups()
    )

    expect(result.removeIframeLayerIds.sort()).toEqual(["a1", "a2"])
    expect(result.nextSelection.iframeLayerIds.size).toBe(0)
    expect(result.nextSelection.groupIds.size).toBe(0)
  })

  it("cascades a selected group to all its members across kinds and clears", () => {
    const result = resolveSelectionDelete(
      snapshot({ groupIds: new Set(["g2"]) }),
      groups()
    )

    expect(result.removeIframeLayerIds).toEqual(["b1"])
    expect(result.removeMarkdownLayerIds).toEqual(["d1"])
    expect(result.nextSelection.iframeLayerIds.size).toBe(0)
    expect(result.nextSelection.groupIds.size).toBe(0)
    expect(result.nextSelection.markdownLayerIds.size).toBe(0)
  })

  it("does not keep a neighbor when a single frame is deleted alongside a doc", () => {
    const result = resolveSelectionDelete(
      snapshot({
        iframeLayerIds: new Set(["a1"]),
        markdownLayerIds: new Set(["d1"]),
      }),
      groups()
    )

    expect(result.removeIframeLayerIds).toEqual(["a1"])
    expect(result.removeMarkdownLayerIds).toEqual(["d1"])
    expect(result.nextSelection.iframeLayerIds.size).toBe(0)
    expect(result.nextSelection.markdownLayerIds.size).toBe(0)
  })

  it("removes only docs and leaves an untouched frame selection in place", () => {
    const result = resolveSelectionDelete(
      snapshot({ markdownLayerIds: new Set(["d1"]) }),
      groups()
    )

    expect(result.removeIframeLayerIds).toEqual([])
    expect(result.removeMarkdownLayerIds).toEqual(["d1"])
    expect(result.nextSelection.markdownLayerIds.size).toBe(0)
  })

  it("reports no removals for an empty selection", () => {
    const result = resolveSelectionDelete(snapshot(), groups())
    expect(result.hasRemovals).toBe(false)
    expect(result.removeIframeLayerIds).toEqual([])
    expect(result.removeMarkdownLayerIds).toEqual([])
  })
})

describe("toggleSelection — shift-toggle rule", () => {
  it("adds an absent id", () => {
    expect([...toggleSelection(new Set(["a1"]), "a2")].sort()).toEqual([
      "a1",
      "a2",
    ])
  })

  it("removes a present id", () => {
    expect([...toggleSelection(new Set(["a1", "a2"]), "a1")]).toEqual(["a2"])
  })

  it("does not mutate the input set", () => {
    const input = new Set(["a1"])
    toggleSelection(input, "a2")
    expect([...input]).toEqual(["a1"])
  })
})

describe("projections", () => {
  it("overlaySelectedIds unions iframe and markdown selections", () => {
    const ids = overlaySelectedIds(
      snapshot({
        iframeLayerIds: new Set(["a1", "a2"]),
        markdownLayerIds: new Set(["d1"]),
      })
    )
    expect([...ids].sort()).toEqual(["a1", "a2", "d1"])
  })

  it("groupSelectedMemberIds returns all members of selected groups", () => {
    const ids = groupSelectedMemberIds(
      snapshot({ groupIds: new Set(["g2"]) }),
      groups()
    )
    expect([...ids].sort()).toEqual(["b1", "d1"])
  })

  it("groupSelectedMemberIds is empty when no group is selected", () => {
    const ids = groupSelectedMemberIds(
      snapshot({ iframeLayerIds: new Set(["a1"]) }),
      groups()
    )
    expect(ids.size).toBe(0)
  })
})
