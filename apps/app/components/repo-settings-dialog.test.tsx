// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { resetCanvasRepoEnv } from "@/lib/repo-env/actions"
import { baseRepo } from "@/test/canvas/harness"
import { RepoSettingsDialog } from "./repo-settings-dialog"

vi.mock("@/lib/repo-env/actions", () => ({
  saveCanvasRepoEnv: vi.fn(),
  resetCanvasRepoEnv: vi.fn(),
  revealCanvasRepoEnv: vi.fn(),
}))

// Radix's Dialog uses pointer-capture / scroll APIs jsdom doesn't implement,
// plus a ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
}

afterEach(() => {
  cleanup()
  vi.mocked(resetCanvasRepoEnv).mockReset()
})

const repository: RepoConfig = {
  id: "web",
  name: "",
  repoFullName: "owner/repo",
  repoOwner: "owner",
  repoName: "repo",
  defaultBranch: "main",
  cloneUrl: "https://example.com/repo.git",
  private: true,
  setupScript: "pnpm install",
  devScript: "pnpm dev",
  devServerPort: 3000,
  envVars: "A=1",
  envVarsDigest: "d-a1",
  createdAt: 1,
  updatedAt: 1,
}

// Customized on this canvas: its own port and its own env values.
const repo = baseRepo("repo-1", {
  name: "",
  setupScript: "pnpm install",
  devScript: "pnpm dev",
  devServerPort: 4000,
  repositoryId: "web",
  envVarNames: ["A", "B"],
  envVarsDigest: "d-mine",
})

function renderDialog() {
  const onUpdate = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <RepoSettingsDialog
      roomId="room-1"
      canRevealEnv
      repo={repo}
      repository={repository}
      open
      onOpenChange={onOpenChange}
      onUpdate={onUpdate}
    />
  )
  return { onUpdate, onOpenChange }
}

describe("Reset to Settings", () => {
  it("resets the env vars on the server first, then the other settings", async () => {
    vi.mocked(resetCanvasRepoEnv).mockResolvedValue()
    const { onUpdate, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Reset to Settings" }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(resetCanvasRepoEnv).toHaveBeenCalledWith("room-1", "repo-1", "A=1")
    expect(onUpdate).toHaveBeenCalledWith(
      "repo-1",
      expect.objectContaining({ devServerPort: 3000 })
    )
    // The env module names the values in the doc itself (#1492).
    expect(onUpdate.mock.calls[0]![1]).not.toHaveProperty("envVarNames")
    expect(onUpdate.mock.calls[0]![1]).not.toHaveProperty("envVarsDigest")
  })

  it("leaves the Repo unchanged and the dialog open when the values can’t be stored", async () => {
    vi.mocked(resetCanvasRepoEnv).mockRejectedValue(new Error("KV down"))
    const { onUpdate, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Reset to Settings" }))

    expect(
      await screen.findByText("Couldn’t restore the environment variables.")
    ).toBeDefined()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
