import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { getRoomCollections } from "@/lib/yjs/schema"
import { documentWorkspaceIds } from "./document-owner"
import {
  groupBranchId,
  groupSwitchSummary,
  groupWorkspace,
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

describe("documentWorkspaceIds", () => {
  it("maps each chat-made Document to its chat's Workspace", () => {
    expect(
      documentWorkspaceIds(
        [
          { id: "doc-1", ownerChatId: "chat-1" },
          { id: "doc-2" },
          { id: "doc-3", ownerChatId: "gone" },
          { id: "doc-4", ownerChatId: "room-chat" },
        ],
        [{ id: "chat-1", branchId: "ws-1" }, { id: "room-chat" }]
      )
    ).toEqual(new Map([["doc-1", "ws-1"]]))
  })
})

describe("groupSwitchSummary", () => {
  it("counts the frames that move", () => {
    expect(groupSwitchSummary(2)).toBe(
      "Moves 2 frames. Each keeps its route and state."
    )
    expect(groupSwitchSummary(1)).toBe(
      "Moves 1 frame. It keeps its route and state."
    )
  })
})
