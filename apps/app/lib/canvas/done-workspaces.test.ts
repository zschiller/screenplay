import { describe, expect, it } from "vitest"
import type { IframeLayerData, IframeLayerGroupData } from "@/lib/types"
import {
  countWorkspaceFrames,
  hideDoneWorkspaceFrames,
  keepHiddenMembers,
  markedDoneMessage,
} from "./done-workspaces"

const frame = (id: string, branchId?: string): IframeLayerData => ({
  id,
  branchId,
  width: 100,
  height: 100,
  label: id,
  iframeState: {},
})

const group = (
  id: string,
  members: string[],
  branchId?: string
): IframeLayerGroupData => ({
  id,
  x: 0,
  y: 0,
  branchId,
  members: members.map((m) => ({
    kind: m.startsWith("doc") ? "markdown-layer" : "iframe-layer",
    id: m,
  })),
})

const iframeLayers = [
  frame("cart", "a"),
  frame("payment", "a"),
  frame("promo", "b"),
  frame("summary", "b"),
]
const groups = [
  group("checkout", ["cart", "payment", "doc-brief"], "a"),
  group("promo", ["promo", "summary"], "b"),
]

describe("hideDoneWorkspaceFrames", () => {
  it("shows everything when no Workspace is done", () => {
    const view = hideDoneWorkspaceFrames({
      groups,
      iframeLayers,
      branches: [{ id: "a" }, { id: "b" }],
    })
    expect(view.groups).toBe(groups)
    expect(view.iframeLayers).toBe(iframeLayers)
  })

  it("hides a Done Workspace's frames and keeps its Group's documents", () => {
    const view = hideDoneWorkspaceFrames({
      groups,
      iframeLayers,
      branches: [{ id: "a", doneAt: 1 }, { id: "b" }],
    })
    expect(view.groups.map((g) => g.id)).toEqual(["checkout", "promo"])
    expect(view.groups[0]!.members.map((m) => m.id)).toEqual(["doc-brief"])
    expect(view.iframeLayers.map((l) => l.id)).toEqual(["promo", "summary"])
  })

  it("keeps another Workspace's frame in a Done Workspace's Group", () => {
    const view = hideDoneWorkspaceFrames({
      groups: [group("checkout", ["cart", "promo", "payment"], "a")],
      iframeLayers,
      branches: [{ id: "a", doneAt: 1 }, { id: "b" }],
    })
    expect(view.groups[0]!.members.map((m) => m.id)).toEqual(["promo"])
    expect(view.iframeLayers.map((l) => l.id)).toEqual(["promo", "summary"])
  })

  it("hides a frame that follows a Done Workspace's Group", () => {
    const view = hideDoneWorkspaceFrames({
      groups: [group("checkout", ["cart", "blank"], "a")],
      iframeLayers: [...iframeLayers, frame("blank")],
      branches: [{ id: "a", doneAt: 1 }],
    })
    expect(view.groups).toEqual([])
    expect(view.iframeLayers.map((l) => l.id)).not.toContain("blank")
  })

  it("hides an exception frame on its own and keeps the rest of its Group", () => {
    const withException = [
      group("checkout", ["cart", "summary", "payment"], "a"),
      group("promo", ["promo"], "b"),
    ]
    const view = hideDoneWorkspaceFrames({
      groups: withException,
      iframeLayers,
      branches: [{ id: "a" }, { id: "b", doneAt: 1 }],
    })
    expect(view.groups).toHaveLength(1)
    expect(view.groups[0]!.members.map((m) => m.id)).toEqual([
      "cart",
      "payment",
    ])
    expect(view.iframeLayers.map((l) => l.id)).toEqual(["cart", "payment"])
  })

  it("reads a Group's Workspace from its leftmost frame when it has none", () => {
    const view = hideDoneWorkspaceFrames({
      groups: [group("legacy", ["promo", "doc-brief"])],
      iframeLayers,
      branches: [{ id: "b", doneAt: 1 }],
    })
    expect(view.groups[0]!.members.map((m) => m.id)).toEqual(["doc-brief"])
  })
})

describe("countWorkspaceFrames", () => {
  it("counts the Workspace's own frames and the ones following its Group", () => {
    expect(
      countWorkspaceFrames(
        "a",
        [group("checkout", ["cart", "promo", "blank", "doc-brief"], "a")],
        [...iframeLayers, frame("blank")]
      )
    ).toBe(3)
  })
})

describe("markedDoneMessage", () => {
  it("says how many frames are hidden", () => {
    expect(markedDoneMessage("Checkout polish", 2)).toBe(
      "Marked “Checkout polish” done. Its 2 frames are hidden."
    )
    expect(markedDoneMessage("Checkout polish", 1)).toBe(
      "Marked “Checkout polish” done. Its frame is hidden."
    )
    expect(markedDoneMessage("Checkout polish", 0)).toBe(
      "Marked “Checkout polish” done."
    )
  })
})

describe("keepHiddenMembers", () => {
  const m = (id: string) => ({ kind: "iframe-layer" as const, id })

  it("returns the reorder as is when nothing is hidden", () => {
    const reordered = [m("b"), m("a")]
    expect(keepHiddenMembers([m("a"), m("b")], reordered)).toBe(reordered)
  })

  it("keeps a hidden member at its index", () => {
    expect(
      keepHiddenMembers(
        [m("a"), m("hidden"), m("b"), m("c")],
        [m("c"), m("a"), m("b")]
      ).map((x) => x.id)
    ).toEqual(["c", "hidden", "a", "b"])
  })
})
