// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { RepoConfig } from "@/lib/repo-configs.types"

// One GitHub repository to pick, and detection that finds nothing (the form
// opens on plain defaults).
vi.mock("@/lib/github-actions", () => ({
  listUserRepos: vi.fn().mockResolvedValue([
    {
      id: 1,
      fullName: "acme/api",
      name: "api",
      private: false,
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/api.git",
      htmlUrl: "https://github.com/acme/api",
      owner: "acme",
      pushedAt: "2026-09-01T00:00:00Z",
    },
  ]),
}))
vi.mock("@/lib/github-local/actions", () => ({
  getGitHubLocalStatus: vi.fn().mockResolvedValue(null),
  resolveRepoFromUrl: vi.fn(),
}))
vi.mock("@/lib/add-repo/actions", () => ({
  detectRepoSettings: vi.fn().mockResolvedValue({ ok: false }),
  detectFolderSettings: vi.fn().mockResolvedValue({ ok: false }),
  refineRepoSettings: vi.fn().mockResolvedValue({ ok: false }),
  refineFolderSettings: vi.fn().mockResolvedValue({ ok: false }),
}))
vi.mock("@/lib/repository-library/actions", () => ({
  listRepositories: vi.fn().mockResolvedValue([]),
  saveRepository: vi.fn(async (r: RepoConfig) => [r]),
  deleteRepository: vi.fn(),
}))

import { saveRepository } from "@/lib/repository-library/actions"
import { RepoConfigsPanel } from "./repo-configs-panel"

// Radix's Dialog and cmdk use pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver. Polyfill the bare minimum.
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

afterEach(cleanup)

describe("Settings › Repositories (#1423)", () => {
  it("New repository goes through the picker and settings form, and saves it", async () => {
    render(<RepoConfigsPanel header={(action) => <div>{action}</div>} />)

    fireEvent.click(
      await screen.findByRole("button", { name: "New repository" })
    )
    const picker = await screen.findByRole("dialog", {
      name: "Open GitHub repository",
    })
    fireEvent.click(await within(picker).findByText("acme/api"))

    const configure = await screen.findByRole("dialog", {
      name: "Configure repository",
    })
    expect(within(configure).queryByText(/Save as a preset/)).toBeNull()
    fireEvent.click(
      within(configure).getByRole("button", { name: "Add repository" })
    )

    await waitFor(() => expect(saveRepository).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveRepository).mock.calls[0]![0]).toMatchObject({
      repoFullName: "acme/api",
      devServerPort: 3000,
    })
    // The list shows it once saved.
    expect(await screen.findByText("acme/api")).not.toBeNull()
  })
})
