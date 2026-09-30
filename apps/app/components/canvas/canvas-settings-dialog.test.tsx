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
import type { BranchData, MemoryData, RepoData } from "@/lib/types"

// The add flow's server actions: one GitHub repository to pick, no presets,
// and detection that finds nothing (the form opens on plain defaults).
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
vi.mock("@/lib/repo-configs-actions", () => ({
  listRepoConfigs: vi.fn().mockResolvedValue([]),
  upsertRepoConfig: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/lib/add-repo/actions", () => ({
  detectRepoSettings: vi.fn().mockResolvedValue({ ok: false }),
  detectFolderSettings: vi.fn().mockResolvedValue({ ok: false }),
  refineRepoSettings: vi.fn().mockResolvedValue({ ok: false }),
  refineFolderSettings: vi.fn().mockResolvedValue({ ok: false }),
}))
// The remove confirm reads each Workspace's git state, the GitHub token and
// its chats' turns (for the state icon); none matters to what this dialog does
// with the answer.
vi.mock("@/components/workspace-mention", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/workspace-mention")>()),
  useWorkspaceAgentWorking: () => () => false,
}))
vi.mock("@/hooks/use-unsaved-work", () => ({
  useUnsavedWork: () => new Map(),
}))
vi.mock("@/hooks/use-github-token", () => ({
  useGitHubTokenAvailable: () => false,
}))

import { CanvasSettingsDialog } from "./canvas-settings-dialog"

// Radix's Dialog, menus and cmdk use pointer-capture / scroll APIs jsdom
// doesn't implement, plus a ResizeObserver. Polyfill the bare minimum.
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
// The shadcn Sidebar asks whether it's on a phone.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia

afterEach(cleanup)

function repo(over: Partial<RepoData>): RepoData {
  return {
    id: "r1",
    name: "",
    repoFullName: "acme/storefront",
    repoOwner: "acme",
    repoName: "storefront",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/storefront.git",
    setupScript: "pnpm install",
    devScript: "pnpm dev",
    devServerPort: 3000,
    envVars: "",
    createdAt: 1,
    ...over,
  }
}

const STOREFRONT = repo({})
const DOCS = repo({
  id: "r2",
  name: "docs",
  repoFullName: "acme/site",
  repoName: "site",
  createdAt: 2,
})
const BRANCHES = [
  {
    id: "b1",
    repoId: "r1",
    ref: "checkout-polish",
    title: "Checkout polish",
    colorIndex: 0,
  } as BranchData,
]

const MEMORIES: MemoryData[] = [
  {
    id: "mem-1",
    text: "Use pnpm, never npm.",
    source: "coordinator",
    createdAt: 1,
    updatedAt: 1,
  },
]

function renderDialog(
  repos: RepoData[] = [STOREFRONT, DOCS],
  memories: MemoryData[] = MEMORIES
) {
  const handlers = {
    onCreateRepo: vi.fn(),
    onUpdateRepo: vi.fn(),
    onRemoveRepo: vi.fn().mockResolvedValue(undefined),
    onAddMemory: vi.fn(),
    onEditMemory: vi.fn(),
    onRemoveMemory: vi.fn(),
  }
  render(
    <CanvasSettingsDialog
      open
      onOpenChange={vi.fn()}
      repos={repos}
      branches={BRANCHES}
      memories={memories}
      {...handlers}
    />
  )
  return handlers
}

function openMemory() {
  fireEvent.click(screen.getByRole("button", { name: "Memory" }))
}

describe("CanvasSettingsDialog", () => {
  it("lists each repository by its short name over its source", () => {
    renderDialog()

    expect(screen.getByText("storefront")).not.toBeNull()
    expect(screen.getByText("acme/storefront")).not.toBeNull()
    // A label wins over the repository's own name.
    expect(screen.getByText("docs")).not.toBeNull()
    expect(screen.getByText("acme/site")).not.toBeNull()
    expect(
      screen.getByText(/Shared with everyone on this canvas/)
    ).not.toBeNull()
  })

  it("says so when the canvas has no repository yet", () => {
    renderDialog([])

    expect(screen.getByText("No repositories yet")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Add repository" })
    ).not.toBeNull()
  })

  it("adds a repository through the picker and its settings", async () => {
    const { onCreateRepo } = renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Add repository" }))
    const picker = await screen.findByRole("dialog", {
      name: "Open GitHub repository",
    })
    fireEvent.click(await within(picker).findByText("acme/api"))

    const configure = await screen.findByRole("dialog", {
      name: "Configure repository",
    })
    // Detection finds nothing, so the form keeps its defaults.
    fireEvent.click(
      within(configure).getByRole("button", { name: "Add repository" })
    )

    expect(onCreateRepo).toHaveBeenCalledTimes(1)
    const [pick, settings] = onCreateRepo.mock.calls[0]!
    expect(pick).toMatchObject({ kind: "repo", repo: { fullName: "acme/api" } })
    expect(settings).toMatchObject({ devServerPort: 3000 })
  })

  it("edits a repository's settings", async () => {
    const { onUpdateRepo } = renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Edit storefront" }))
    const form = await screen.findByRole("dialog", {
      name: "Repository settings",
    })
    fireEvent.change(within(form).getByLabelText("Label"), {
      target: { value: "web" },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Save" }))

    expect(onUpdateRepo).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ name: "web", devScript: "pnpm dev" })
    )
  })

  it("removes a repository through the confirm that lists its workspaces", async () => {
    const { onRemoveRepo } = renderDialog()

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "More actions for storefront" }),
      { button: 0, ctrlKey: false }
    )
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }))

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Checkout polish")).not.toBeNull()
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }))

    await waitFor(() =>
      expect(onRemoveRepo).toHaveBeenCalledWith("r1", {
        deleteBranchesOnRemote: false,
      })
    )
  })

  describe("Memory", () => {
    it("lists each entry with who saved it", () => {
      renderDialog()
      openMemory()

      expect(screen.getByText("Use pnpm, never npm.")).not.toBeNull()
      expect(screen.getByText("Saved by the Coordinator")).not.toBeNull()
    })

    it("says so when the canvas has no memory yet", () => {
      renderDialog(undefined, [])
      openMemory()

      expect(screen.getByText("No memories yet")).not.toBeNull()
    })

    it("adds an entry", async () => {
      const { onAddMemory } = renderDialog(undefined, [])
      openMemory()

      fireEvent.click(screen.getByRole("button", { name: "Add memory" }))
      const form = await screen.findByRole("dialog", { name: "Add memory" })
      fireEvent.change(within(form).getByLabelText("Memory"), {
        target: { value: "Staging deploys on merge." },
      })
      fireEvent.click(within(form).getByRole("button", { name: "Save" }))

      expect(onAddMemory).toHaveBeenCalledWith("Staging deploys on merge.")
    })

    it("edits an entry", async () => {
      const { onEditMemory } = renderDialog()
      openMemory()

      fireEvent.click(screen.getByRole("button", { name: /^Edit memory/ }))
      const form = await screen.findByRole("dialog", { name: "Edit memory" })
      fireEvent.change(within(form).getByLabelText("Memory"), {
        target: { value: "Use pnpm." },
      })
      fireEvent.click(within(form).getByRole("button", { name: "Save" }))

      expect(onEditMemory).toHaveBeenCalledWith("mem-1", "Use pnpm.")
    })

    it("deletes an entry from its menu", async () => {
      const { onRemoveMemory } = renderDialog()
      openMemory()

      fireEvent.pointerDown(
        screen.getByRole("button", { name: /^More actions for memory/ }),
        { button: 0, ctrlKey: false }
      )
      fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))

      expect(onRemoveMemory).toHaveBeenCalledWith("mem-1")
    })
  })
})
