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

// The add flow's server actions: one GitHub repository to pick, and detection that finds nothing (the form opens on plain defaults).
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
// Your Repositories: storefront (on this canvas) and api (not yet).
const { REPOSITORIES } = vi.hoisted(() => ({
  REPOSITORIES: [
    {
      id: "cfg-storefront",
      name: "",
      repoFullName: "acme/storefront",
      repoOwner: "acme",
      repoName: "storefront",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/storefront.git",
      private: false,
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: 3000,
      envVars: "",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "cfg-api",
      name: "",
      repoFullName: "acme/api",
      repoOwner: "acme",
      repoName: "api",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/api.git",
      private: false,
      setupScript: "",
      devScript: "go run .",
      devServerPort: 8080,
      envVars: "",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}))
vi.mock("@/lib/repository-library/actions", () => ({
  listRepositories: vi.fn().mockResolvedValue(REPOSITORIES),
  saveRepository: vi.fn(),
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
vi.mock("@/hooks/use-workspace-states", async () => {
  const { roomWorkspaceFacts, workspaceState } =
    await import("@/lib/branch/workspace-state")
  const room = roomWorkspaceFacts([], [])
  return {
    useWorkspaceStates: () => (branch: Parameters<typeof workspaceState>[0]) =>
      workspaceState(branch, room),
  }
})
vi.mock("@/hooks/use-unsaved-work", () => ({
  useUnsavedWork: () => new Map(),
}))
vi.mock("@/hooks/use-github-token", () => ({
  useGitHubTokenAvailable: () => false,
}))

import type { RepoConfig } from "@/lib/repo-configs.types"
import {
  listRepositories,
  saveRepository,
} from "@/lib/repository-library/actions"
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

afterEach(() => {
  cleanup()
  vi.mocked(listRepositories).mockResolvedValue(REPOSITORIES)
})

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

const STOREFRONT = repo({ repositoryId: "cfg-storefront" })
// On the canvas but linked to none of your Repositories.
const DOCS = repo({
  id: "r2",
  name: "docs",
  repoFullName: "acme/site",
  repoName: "site",
  setupScript: "",
  devScript: "",
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
    onUpdateRepo: vi.fn(),
    onRemoveRepo: vi.fn().mockResolvedValue(undefined),
    onAddMemory: vi.fn(),
    onEditMemory: vi.fn(),
    onRemoveMemory: vi.fn(),
    onSwitchOn: vi.fn(),
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
  it("lists your repositories and the canvas's, switched on or off, with their run scripts", async () => {
    renderDialog()

    const api = await screen.findByRole("switch", {
      name: "Use api on this canvas",
    })
    expect(api.getAttribute("aria-checked")).toBe("false")
    for (const name of ["storefront", "docs"]) {
      expect(
        screen
          .getByRole("switch", { name: `Use ${name} on this canvas` })
          .getAttribute("aria-checked")
      ).toBe("true")
    }
    expect(screen.getAllByText("pnpm install")).toHaveLength(1)
    expect(screen.getByText("go run .")).not.toBeNull()
    expect(screen.getByText("No scripts set")).not.toBeNull()
    // Only what's on the canvas can be edited here.
    expect(screen.queryByRole("button", { name: "Edit api" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Edit storefront" })
    ).not.toBeNull()
  })

  it("turns one of your repositories on", async () => {
    const { onSwitchOn } = renderDialog()

    fireEvent.click(
      await screen.findByRole("switch", { name: "Use api on this canvas" })
    )

    expect(onSwitchOn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cfg-api" })
    )
  })

  it("turns a repository without workspaces off straight away", async () => {
    const { onRemoveRepo } = renderDialog()

    fireEvent.click(
      screen.getByRole("switch", { name: "Use docs on this canvas" })
    )

    expect(onRemoveRepo).toHaveBeenCalledWith("r2", {
      deleteBranchesOnRemote: false,
    })
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("confirms turning off a repository its workspaces use", async () => {
    const { onRemoveRepo } = renderDialog()

    fireEvent.click(
      screen.getByRole("switch", { name: "Use storefront on this canvas" })
    )

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Turn off “storefront”?")).not.toBeNull()
    expect(within(confirm).getByText(/Its workspace is removed/)).not.toBeNull()
    expect(within(confirm).getByText("Checkout polish")).not.toBeNull()
    expect(onRemoveRepo).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Turn off" }))

    await waitFor(() =>
      expect(onRemoveRepo).toHaveBeenCalledWith("r1", {
        deleteBranchesOnRemote: false,
      })
    )
  })

  it("says so when you and the canvas have no repository yet", async () => {
    vi.mocked(listRepositories).mockResolvedValueOnce([])
    renderDialog([])
    await waitFor(() => expect(listRepositories).toHaveBeenCalled())

    expect(screen.getByText("No repositories yet")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "New repository" })
    ).not.toBeNull()
  })

  it("New repository saves it to your repositories and turns it on here", async () => {
    // The server's upsert: saving the repository you already have keeps its id.
    vi.mocked(saveRepository).mockImplementation(async (r: RepoConfig) =>
      REPOSITORIES.map((x) => (x.id === r.id ? r : x))
    )
    const { onSwitchOn } = renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "New repository" }))
    const picker = await screen.findByRole("dialog", {
      name: "Open GitHub repository",
    })
    // The picker lists GitHub's repositories only: yours are on the canvas
    // list already, so it has no section of them.
    expect(within(picker).queryByText("Your repositories")).toBeNull()
    fireEvent.click(await within(picker).findByText("acme/api"))

    const configure = await screen.findByRole("dialog", {
      name: "Configure repository",
    })
    expect(within(configure).queryByText(/Save as a preset/)).toBeNull()
    // Detection finds nothing, so the form keeps its defaults.
    fireEvent.click(
      within(configure).getByRole("button", { name: "Add repository" })
    )

    await waitFor(() => expect(onSwitchOn).toHaveBeenCalledTimes(1))
    expect(saveRepository).toHaveBeenCalledTimes(1)
    // acme/api is already one of yours, so the add updates it in place and
    // turns that one on, rather than saving a second.
    expect(onSwitchOn.mock.calls[0]![0]).toMatchObject({
      id: "cfg-api",
      repoFullName: "acme/api",
      devServerPort: 3000,
    })
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

  it("marks a repository customized on this canvas, and resets it to Settings", async () => {
    const { onUpdateRepo } = renderDialog([
      { ...STOREFRONT, devScript: "pnpm dev --turbo" },
      DOCS,
    ])

    const dot = await screen.findByRole("img", {
      name: "Customized for this canvas",
    })
    // Only the repository that differs from its Settings gets the dot.
    expect(
      screen.getAllByRole("img", { name: "Customized for this canvas" })
    ).toHaveLength(1)
    expect(dot.closest("div")?.textContent).toContain("storefront")

    fireEvent.click(screen.getByRole("button", { name: "Edit storefront" }))
    const form = await screen.findByRole("dialog", {
      name: "Repository settings",
    })
    fireEvent.click(
      within(form).getByRole("button", { name: "Reset to Settings" })
    )

    expect(onUpdateRepo).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        devScript: "pnpm dev",
        setupScript: "pnpm install",
      })
    )
  })

  it("offers no reset when the repository matches its Settings", async () => {
    renderDialog()
    await waitFor(() => expect(listRepositories).toHaveBeenCalled())
    await screen.findByRole("switch", { name: "Use api on this canvas" })

    expect(
      screen.queryByRole("img", { name: "Customized for this canvas" })
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Edit storefront" }))
    const form = await screen.findByRole("dialog", {
      name: "Repository settings",
    })
    expect(
      within(form).queryByRole("button", { name: "Reset to Settings" })
    ).toBeNull()
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
