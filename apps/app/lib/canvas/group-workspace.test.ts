import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { getRoomCollections } from "@/lib/yjs/schema"
import {
  groupBranchId,
  isWorkspaceException,
  mergePreviewBranch,
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

describe("mergePreviewBranch (#870)", () => {
  const frames = new Map([
    ["solo", { branchId: "agent-1" }],
    ["a", { branchId: "agent-2" }],
    ["b", { branchId: "agent-2" }],
  ])
  const group = (ids: string[], branchId?: string) => ({
    branchId,
    members: ids.map((id) => ({ kind: "iframe-layer" as const, id })),
  })

  it("shows a lone frame the Workspace of the Group it's dragged onto", () => {
    expect(
      mergePreviewBranch(
        group(["solo"], "agent-1"),
        group(["a", "b"], "agent-2"),
        frames
      )
    ).toEqual({ layerId: "solo", branchId: "agent-2" })
  })

  it("changes nothing for a larger Group, a same-Workspace target or a target with none", () => {
    expect(
      mergePreviewBranch(
        group(["a", "b"], "agent-2"),
        group(["solo"], "agent-1"),
        frames
      )
    ).toBeUndefined()
    expect(
      mergePreviewBranch(
        group(["a"], "agent-2"),
        group(["b"], "agent-2"),
        frames
      )
    ).toBeUndefined()
    expect(
      mergePreviewBranch(group(["solo"], "agent-1"), { members: [] }, frames)
    ).toBeUndefined()
  })
})
