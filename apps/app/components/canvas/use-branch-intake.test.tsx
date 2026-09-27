// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { makeHarness, baseBranch, baseRepo } from "@/test/canvas/harness"
import type { CanvasOps } from "@/lib/canvas/ops"
import type { ChatTarget } from "@/components/canvas/use-chat-target"

const { deleteBranch } = vi.hoisted(() => ({ deleteBranch: vi.fn() }))
const { deleteSandboxes } = vi.hoisted(() => ({ deleteSandboxes: vi.fn() }))
const { toast } = vi.hoisted(() => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/github-actions", () => ({ deleteBranch }))
vi.mock("@/lib/sandbox/lifecycle", () => ({ deleteSandboxes }))
vi.mock("@/lib/sandbox/git", () => ({ renameAgentBranch: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { useBranchIntake } from "./use-branch-intake"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  deleteBranch.mockResolvedValue({ success: true })
  deleteSandboxes.mockResolvedValue(undefined)
})

/**
 * Mount the controller over a real room Y.Doc seeded with one Repo and one
 * Branch, so "was the Workspace actually deleted?" is answered by the document
 * rather than by a spy.
 */
function mountIntake(
  repoOverrides: Parameters<typeof baseRepo>[1] = {},
  branchOverrides: Parameters<typeof baseBranch>[1] = {}
) {
  const { collections, ops } = makeHarness()
  const repo = baseRepo("repo-1", repoOverrides)
  const branch = baseBranch("branch-1", {
    repoId: "repo-1",
    ref: "feature-a",
    ...branchOverrides,
  })
  collections.repos.set(repo.id, repo)
  collections.branches.set(branch.id, branch)

  const clearIfSelected = vi.fn()
  const chatTarget = { clearIfSelected, addPending: vi.fn() }

  const { result } = renderHook(() =>
    useBranchIntake({
      ops: ops as CanvasOps,
      repos: [repo],
      agents: [branch],
      iframeLayers: [],
      roomId: "room-1",
      updateChatSession: vi.fn(),
      createDefaultTabForBranch: vi.fn(() => "chat-1"),
      getViewportCenter: () => ({ cx: 0, cy: 0 }),
      setSelectedGroupIds: vi.fn(),
      setSelectedIframeLayerIds: vi.fn(),
      handleSelectIframeLayer: vi.fn(),
      chatTarget: chatTarget as unknown as ChatTarget,
    })
  )

  return { collections, result, clearIfSelected }
}

describe("removeBranch — local teardown vs. the remote branch", () => {
  it("commits the local delete even when the remote delete fails", async () => {
    deleteBranch.mockResolvedValue({ success: false, error: "No GitHub token" })
    const { collections, result, clearIfSelected } = mountIntake()

    await act(async () => {
      await result.current.removeBranch("branch-1", { deleteOnRemote: true })
    })

    // The Workspace the user asked to delete is gone regardless.
    expect(collections.branches.get("branch-1")).toBeUndefined()
    expect(clearIfSelected).toHaveBeenCalledWith("branch-1")
    expect(deleteSandboxes).toHaveBeenCalledWith(["sandbox-branch-1"])

    // …and the remote failure surfaces as a warning that names it, never as a
    // thrown error the dialog would render inline over a deleted Workspace.
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledOnce())
    const [title, options] = toast.warning.mock.calls[0] as [
      string,
      { description?: string },
    ]
    expect(title).toContain("feature-a")
    expect(options.description).toBe("No GitHub token")
  })

  it("does not throw when the remote delete rejects outright", async () => {
    deleteBranch.mockRejectedValue(new Error("network down"))
    const { collections, result } = mountIntake()

    await act(async () => {
      await expect(
        result.current.removeBranch("branch-1", { deleteOnRemote: true })
      ).resolves.toBeUndefined()
    })

    expect(collections.branches.get("branch-1")).toBeUndefined()
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledOnce())
  })

  it("never touches the GitHub API when remote deletion wasn't asked for", async () => {
    const { collections, result } = mountIntake()

    await act(async () => {
      await result.current.removeBranch("branch-1", { deleteOnRemote: false })
    })

    expect(collections.branches.get("branch-1")).toBeUndefined()
    expect(deleteBranch).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("skips the API for a Repo with no GitHub remote, whatever was asked", async () => {
    // A local-folder Project whose origin isn't GitHub (ADR 0013): the API can
    // never name it, so there is no call to make and nothing to warn about.
    const { collections, result } = mountIntake({
      repoOwner: "",
      repoName: "",
    })

    await act(async () => {
      await result.current.removeBranch("branch-1", { deleteOnRemote: true })
    })

    expect(collections.branches.get("branch-1")).toBeUndefined()
    expect(deleteBranch).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("deletes the remote branch through the Repo's GitHub identity when asked", async () => {
    const { result } = mountIntake({ repoOwner: "acme", repoName: "widgets" })

    await act(async () => {
      await result.current.removeBranch("branch-1", { deleteOnRemote: true })
    })

    await vi.waitFor(() =>
      expect(deleteBranch).toHaveBeenCalledWith("acme", "widgets", "feature-a")
    )
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
