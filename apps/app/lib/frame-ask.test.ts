import { describe, expect, it } from "vitest"

import {
  defaultFrameAnswerer,
  defaultNewWorkspaceRepoId,
  forMockup,
  withViewport,
} from "@/lib/frame-ask"
import type { BranchData, RepoData } from "@/lib/types"

const repo = (id: string, repoFullName: string) =>
  ({ id, repoFullName }) as RepoData
const branch = (id: string, repoId: string, createdAt: number) =>
  ({ id, repoId, createdAt }) as BranchData

describe("defaultNewWorkspaceRepoId", () => {
  it("picks the newest Workspace's Repo", () => {
    const repos = [repo("a", "acme/a"), repo("b", "acme/b")]
    const branches = [branch("1", "a", 1), branch("2", "b", 5)]
    expect(defaultNewWorkspaceRepoId(repos, branches)).toBe("b")
  })

  it("falls back to the first Repo in sidebar order", () => {
    const repos = [repo("z", "acme/z"), repo("a", "acme/a")]
    expect(defaultNewWorkspaceRepoId(repos, [])).toBe("a")
  })

  it("is null with no Repos", () => {
    expect(defaultNewWorkspaceRepoId([], [])).toBeNull()
  })
})

describe("withViewport", () => {
  it("adds the frame size after the prompt", () => {
    expect(withViewport("A checkout page", { width: 390, height: 844 })).toBe(
      "A checkout page\n\nFor a 390 × 844 viewport."
    )
  })

  it("rounds the size", () => {
    expect(withViewport("x", { width: 390.4, height: 843.6 })).toBe(
      "x\n\nFor a 390 × 844 viewport."
    )
  })
})

describe("defaultFrameAnswerer", () => {
  const world = {
    frames: [
      { id: "f1", branchId: "b1" },
      { id: "f2", branchId: "b2" },
      { id: "f3", branchId: "b1" },
      { id: "blank" },
    ],
    ownedLayers: [
      { id: "mockup", ownerChatId: "c1" },
      { id: "doc", ownerChatId: "c2" },
      { id: "handmade" },
    ],
    chatSessions: [
      { id: "c1", branchId: "b1" },
      { id: "c2", branchId: "b2" },
    ],
    pickable: [{ id: "b1" }, { id: "b2" }],
  }
  const answer = (frameIds: string[], ownedLayerIds: string[] = []) =>
    defaultFrameAnswerer({ ...world, frameIds, ownedLayerIds })

  it("answers with a selected frame's Workspace", () => {
    expect(answer(["f2"])).toEqual({ kind: "workspace", branchId: "b2" })
  })

  it("answers with a selected Mockup's owner chat's Workspace", () => {
    expect(answer([], ["mockup"])).toEqual({
      kind: "workspace",
      branchId: "b1",
    })
  })

  it("answers with a selected Document's owner chat's Workspace", () => {
    expect(answer([], ["doc"])).toEqual({ kind: "workspace", branchId: "b2" })
  })

  it("answers with the one Workspace several layers share", () => {
    expect(answer(["f1", "f3"], ["mockup"])).toEqual({
      kind: "workspace",
      branchId: "b1",
    })
  })

  it("starts a new chat for layers on different Workspaces", () => {
    expect(answer(["f1", "f2"])).toEqual({ kind: "new-chat" })
  })

  it("starts a new chat with nothing selected", () => {
    expect(answer([])).toEqual({ kind: "new-chat" })
  })

  it("starts a new chat for a blank frame or a hand-made Document", () => {
    expect(answer(["blank"])).toEqual({ kind: "new-chat" })
    expect(answer([], ["handmade"])).toEqual({ kind: "new-chat" })
  })

  it("starts a new chat when the Workspace can't be picked", () => {
    expect(
      defaultFrameAnswerer({
        ...world,
        pickable: [{ id: "b2" }],
        frameIds: ["f1"],
        ownedLayerIds: [],
      })
    ).toEqual({ kind: "new-chat" })
  })
})

describe("forMockup", () => {
  it("names the drawn Mockup and its viewport after what was typed", () => {
    expect(forMockup(" An empty cart ", "m-1", { width: 390.4, height: 844 }))
      .toBe(`An empty cart

Sketch it in Mockup [mockup: m-1] with update_mockup, for a 390 × 844 viewport.`)
  })

  it("still names the Mockup when nothing was typed", () => {
    expect(forMockup("", "m-1", { width: 1280, height: 800 })).toBe(
      "Sketch it in Mockup [mockup: m-1] with update_mockup, for a 1280 × 800 viewport."
    )
  })
})
