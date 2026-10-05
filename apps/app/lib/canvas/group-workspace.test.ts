import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { getRoomCollections } from "@/lib/yjs/schema"
import { groupBranchId, groupWorkspace } from "./group-workspace"

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

describe("groupWorkspace", () => {
  const moreFrames = new Map([
    ...frames,
    ["a2", { branchId: "ws-1" }],
    ["empty2", {}],
  ])
  const group = (...ids: string[]) => ({
    members: [
      { kind: "markdown-layer" as const, id: "doc" },
      ...ids.map((id) => ({ kind: "iframe-layer" as const, id })),
    ],
  })

  it("names the Workspace every frame shows, skipping Documents", () => {
    expect(groupWorkspace(group("a", "a2"), moreFrames)).toEqual({
      branchId: "ws-1",
      frames: ["a", "a2"],
    })
  })

  it("names none when the frames show different Workspaces", () => {
    expect(groupWorkspace(group("a", "b"), moreFrames)).toBeNull()
  })

  it("names none when only some frames have a Workspace", () => {
    expect(groupWorkspace(group("a", "empty"), moreFrames)).toBeNull()
  })

  it("offers the choice once when no frame has a Workspace yet", () => {
    expect(groupWorkspace(group("empty", "empty2"), moreFrames)).toEqual({
      branchId: undefined,
      frames: ["empty", "empty2"],
    })
  })

  it("ignores the Group's own stored Workspace", () => {
    const stored = { ...group("a", "a2"), branchId: "ws-2" }
    expect(groupWorkspace(stored, moreFrames)?.branchId).toBe("ws-1")
  })

  it("names none for a Group of Documents", () => {
    expect(groupWorkspace(group(), moreFrames)).toBeNull()
  })

  // #1314: a Document a chat made counts as showing the chat's Workspace.
  describe("with chat-made Documents", () => {
    it("names the Workspace when the Document's chat is the frames'", () => {
      const docs = new Map([["doc", "ws-1"]])
      expect(groupWorkspace(group("a", "a2"), moreFrames, docs)).toEqual({
        branchId: "ws-1",
        frames: ["a", "a2"],
      })
    })

    it("names none when the Document's chat is another Workspace's", () => {
      const docs = new Map([["doc", "ws-2"]])
      expect(groupWorkspace(group("a", "a2"), moreFrames, docs)).toBeNull()
    })

    it("names the chat's Workspace on a Group of its Documents alone", () => {
      const docs = new Map([["doc", "ws-1"]])
      expect(groupWorkspace(group(), moreFrames, docs)).toEqual({
        branchId: "ws-1",
        frames: [],
      })
    })

    it("lets a hand-made Document leave the label alone", () => {
      expect(groupWorkspace(group("a"), moreFrames, new Map())).toEqual({
        branchId: "ws-1",
        frames: ["a"],
      })
    })
  })
})

describe("the label rule with Mockups (#1309)", () => {
  // Each chat-made Mockup's Workspace, as for a Document.
  const owned = new Map([
    ["m1", "ws-1"],
    ["m1b", "ws-1"],
    ["m2", "ws-2"],
  ])
  const group = (...members: [string, string][]) => ({
    members: members.map(([kind, id]) => ({
      kind: kind as "iframe-layer" | "mockup-layer",
      id,
    })),
  })

  it("names the Workspace when the Mockups' chat is on it", () => {
    const g = group(["iframe-layer", "a"], ["mockup-layer", "m1"])
    expect(groupWorkspace(g, frames, owned)?.branchId).toBe("ws-1")
  })

  it("names none when a Mockup's chat is on another Workspace", () => {
    const g = group(["iframe-layer", "a"], ["mockup-layer", "m2"])
    expect(groupWorkspace(g, frames, owned)).toBeNull()
  })

  it("names the Workspace on a Group of one chat's Mockups", () => {
    const g = group(["mockup-layer", "m1"], ["mockup-layer", "m1b"])
    expect(groupWorkspace(g, frames, owned)).toEqual({
      branchId: "ws-1",
      frames: [],
    })
  })

  it("ignores a Mockup whose chat is gone", () => {
    const g = group(["iframe-layer", "a"], ["mockup-layer", "orphan"])
    expect(groupWorkspace(g, frames, owned)?.branchId).toBe("ws-1")
  })
})
