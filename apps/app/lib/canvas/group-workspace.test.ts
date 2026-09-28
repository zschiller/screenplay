import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { getRoomCollections } from "@/lib/yjs/schema"
import {
  groupBranchId,
  groupSwitchFrames,
  groupSwitchSummary,
  isWorkspaceException,
} from "./group-workspace"

const frames = new Map([
  ["a", { branchId: "ws-1" }],
  ["b", { branchId: "ws-2" }],
  ["empty", {}],
])

describe("groupBranchId", () => {
  it("prefers the Group's own Workspace", () => {
    expect(
      groupBranchId(
        { branchId: "ws-2", members: [{ kind: "iframe-layer", id: "a" }] },
        frames
      )
    ).toBe("ws-2")
  })

  it("falls back to the leftmost frame that has a Workspace", () => {
    expect(
      groupBranchId(
        {
          members: [
            { kind: "markdown-layer", id: "doc" },
            { kind: "iframe-layer", id: "empty" },
            { kind: "iframe-layer", id: "b" },
            { kind: "iframe-layer", id: "a" },
          ],
        },
        frames
      )
    ).toBe("ws-2")
  })

  it("is unset for a Group of Documents", () => {
    expect(
      groupBranchId(
        { members: [{ kind: "markdown-layer", id: "doc" }] },
        frames
      )
    ).toBeUndefined()
  })
})

describe("isWorkspaceException", () => {
  it("is true only when the frame shows another Workspace than its Group", () => {
    expect(isWorkspaceException({ branchId: "ws-1" }, "ws-1")).toBe(false)
    expect(isWorkspaceException({ branchId: "ws-2" }, "ws-1")).toBe(true)
    expect(isWorkspaceException({}, "ws-1")).toBe(false)
    expect(isWorkspaceException({ branchId: "ws-2" }, undefined)).toBe(false)
  })
})

describe("on-load conversion", () => {
  function seed(fn: (doc: Y.Doc) => void): Y.Doc {
    const doc = new Y.Doc()
    fn(doc)
    return doc
  }
  function setRecord(doc: Y.Doc, key: string, id: string, data: object) {
    const m = new Y.Map<unknown>()
    for (const [k, v] of Object.entries(data)) m.set(k, v)
    ;(doc.getMap(key) as Y.Map<Y.Map<unknown>>).set(id, m)
  }

  it("gives each Group its leftmost frame's Workspace, so no frame changes", () => {
    const doc = seed((d) => {
      setRecord(d, "iframeLayers", "f1", {
        id: "f1",
        branchId: "ws-1",
        width: 1,
        height: 1,
        label: "One",
        iframeState: {},
      })
      setRecord(d, "iframeLayers", "f2", {
        id: "f2",
        branchId: "ws-2",
        width: 1,
        height: 1,
        label: "Two",
        iframeState: {},
      })
      setRecord(d, "iframeLayerGroups", "mixed", {
        id: "mixed",
        name: "Mixed",
        x: 0,
        y: 0,
        members: [
          { kind: "markdown-layer", id: "doc" },
          { kind: "iframe-layer", id: "f2" },
          { kind: "iframe-layer", id: "f1" },
        ],
      })
      setRecord(d, "iframeLayerGroups", "set", {
        id: "set",
        name: "Set",
        x: 0,
        y: 0,
        branchId: "ws-1",
        members: [{ kind: "iframe-layer", id: "f2" }],
      })
    })

    const c = getRoomCollections(doc)

    expect(c.iframeLayerGroups.get("mixed")?.branchId).toBe("ws-2")
    // A Group that already has one keeps it.
    expect(c.iframeLayerGroups.get("set")?.branchId).toBe("ws-1")
    // Frames keep the Workspace they showed; f1 is now an exception.
    expect(c.iframeLayers.get("f1")?.branchId).toBe("ws-1")
    expect(c.iframeLayers.get("f2")?.branchId).toBe("ws-2")
  })
})

describe("groupSwitchFrames", () => {
  it("splits a Group's frames into followers and exceptions, skipping Documents", () => {
    expect(
      groupSwitchFrames(
        {
          branchId: "ws-1",
          members: [
            { kind: "iframe-layer", id: "a" },
            { kind: "markdown-layer", id: "doc" },
            { kind: "iframe-layer", id: "b" },
            { kind: "iframe-layer", id: "empty" },
          ],
        },
        frames
      )
    ).toEqual({ following: ["a", "empty"], exceptions: ["b"] })
  })

  it("uses the leftmost frame's Workspace for a Group without its own", () => {
    expect(
      groupSwitchFrames(
        {
          members: [
            { kind: "iframe-layer", id: "b" },
            { kind: "iframe-layer", id: "a" },
          ],
        },
        frames
      )
    ).toEqual({ following: ["b"], exceptions: ["a"] })
  })
})

describe("groupSwitchSummary", () => {
  it("counts the frames that move", () => {
    expect(groupSwitchSummary(2, [])).toEqual([
      "Moves 2 frames. Each keeps its route and state.",
    ])
    expect(groupSwitchSummary(1, [])).toEqual([
      "Moves 1 frame. It keeps its route and state.",
    ])
  })

  it("names an exception and the Workspace it stays on", () => {
    expect(
      groupSwitchSummary(2, [
        { name: "Gift card balance", workspace: "gift-cards" },
      ])
    ).toEqual([
      "Moves 2 frames. Each keeps its route and state.",
      "Gift card balance stays on gift-cards.",
    ])
  })

  it("lists several exceptions, shortening a long list", () => {
    expect(
      groupSwitchSummary(1, [
        { name: "Pay", workspace: "a" },
        { name: "Cart", workspace: "b" },
      ])[1]
    ).toBe("Pay and Cart stay on their own workspaces.")
    expect(
      groupSwitchSummary(1, [
        { name: "A" },
        { name: "B" },
        { name: "C" },
        { name: "D" },
      ])[1]
    ).toBe("A, B and 2 more stay on their own workspaces.")
  })
})
