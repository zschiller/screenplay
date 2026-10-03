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
import type {
  BranchData,
  FileEntryData,
  MemoryData,
  RepoData,
} from "@/lib/types"
import { revealCanvasRepoEnv, saveCanvasRepoEnv } from "@/lib/repo-env/actions"

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
  saveRepositoryToAll: vi.fn().mockResolvedValue(REPOSITORIES),
}))
// A Repo's env var values live on the server (#1416).
vi.mock("@/lib/repo-env/actions", () => ({
  saveCanvasRepoEnv: vi.fn().mockResolvedValue(undefined),
  resetCanvasRepoEnv: vi.fn().mockResolvedValue(undefined),
  revealCanvasRepoEnv: vi
    .fn()
    .mockResolvedValue("API_URL=https://api.test\nSTRIPE_KEY=sk_live_1"),
}))
// A shared canvas: you (Zack) and Mia.
vi.mock("@/lib/rooms-actions", () => ({
  listCollaborators: vi.fn().mockResolvedValue([
    {
      userId: "zack",
      name: "Zack",
      email: null,
      avatar: null,
      isOwner: true,
    },
    { userId: "mia", name: "Mia", email: null, avatar: null, isOwner: false },
  ]),
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
  saveRepositoryToAll,
} from "@/lib/repository-library/actions"
import {
  desktopLinkPolicy,
  hostedLinkPolicy,
  type RepositoryLinkPolicy,
} from "@/lib/repository-library"
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
  vi.mocked(saveRepositoryToAll).mockClear()
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
    createdAt: 1,
    ...over,
  }
}

const STOREFRONT = repo({ repositoryId: "cfg-storefront", addedBy: "zack" })
// Mia switched on one of her Repositories here.
const MIAS_WEB = repo({
  id: "r3",
  name: "web",
  repoFullName: "mia/web",
  repoName: "web",
  devScript: "next dev",
  createdAt: 3,
  repositoryId: "cfg-mia-web",
  addedBy: "mia",
})
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
  memories: MemoryData[] = MEMORIES,
  {
    canReveal = true,
    policy = desktopLinkPolicy,
    files = [],
  }: {
    canReveal?: boolean
    policy?: RepositoryLinkPolicy
    files?: FileEntryData[]
  } = {}
) {
  const handlers = {
    onUpdateRepo: vi.fn(),
    onRemoveRepo: vi.fn().mockResolvedValue(undefined),
    onAddMemory: vi.fn(),
    onEditMemory: vi.fn(),
    onRemoveMemory: vi.fn(),
    onSwitchOn: vi.fn(),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <CanvasSettingsDialog
      roomId="room-1"
      canRevealEnv={() => canReveal}
      open
      onOpenChange={vi.fn()}
      userId="zack"
      repos={repos}
      branches={BRANCHES}
      memories={memories}
      files={files}
      policy={policy}
      {...handlers}
    />
  )
  return handlers
}

function openMemory() {
  fireEvent.click(screen.getByRole("button", { name: "Memory" }))
}

describe("CanvasSettingsDialog", () => {
  it("lists the canvas's repositories, then yours to add, with their run scripts", async () => {
    renderDialog()
    await screen.findByRole("button", { name: "Add api" })

    const names = (label: string) =>
      within(screen.getByRole("region", { name: label }))
        .getAllByRole("button", { name: /^(Add|Remove) / })
        .map((s) => s.getAttribute("aria-label"))
    expect(names("On this canvas")).toEqual([
      "Remove docs",
      "Remove storefront",
    ])
    expect(names("Your other repositories")).toEqual(["Add api"])
    // No switch: removing takes a repository's chats with it (H3).
    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.getAllByText("pnpm install")).toHaveLength(1)
    expect(screen.getByText("go run .")).not.toBeNull()
    expect(screen.getByText("No scripts set")).not.toBeNull()
    // Only what's on the canvas can be edited here.
    expect(screen.queryByRole("button", { name: "Edit api" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Edit storefront" })
    ).not.toBeNull()
  })

  it("names each repository by owner/name, as Settings does, and links there", async () => {
    renderDialog()

    // DOCS is labelled "docs": the label follows its owner/name, muted.
    const docs = await screen.findByText("acme/site")
    expect(docs.textContent).toBe("acme/site docs")
    // A label that repeats the repository's name adds nothing.
    expect(screen.getByText("acme/storefront").textContent).toBe(
      "acme/storefront"
    )
    expect(
      screen
        .getByRole("link", { name: "Manage in Settings" })
        .getAttribute("href")
    ).toBe("/settings?section=repositories")
  })

  it("adds one of your repositories", async () => {
    const { onSwitchOn } = renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: "Add api" }))

    expect(onSwitchOn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cfg-api" })
    )
  })

  it("leaves out one of yours the canvas already has under the same name", async () => {
    // Someone else's acme/api, as the migration or a teammate left it.
    renderDialog([
      STOREFRONT,
      repo({ id: "r4", name: "", repoFullName: "acme/api", repoName: "api" }),
    ])
    await screen.findByRole("button", { name: "Remove api" })

    expect(screen.queryByRole("button", { name: "Add api" })).toBeNull()
    expect(
      screen.queryByRole("region", { name: "Your other repositories" })
    ).toBeNull()
  })

  it("removes a repository without workspaces or changes straight away", async () => {
    const { onRemoveRepo } = renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: "Remove docs" }))

    expect(onRemoveRepo).toHaveBeenCalledWith("r2", {
      deleteBranchesOnRemote: false,
    })
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("confirms removing a repository its workspaces use", async () => {
    const { onRemoveRepo } = renderDialog()

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove storefront" })
    )

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Remove “storefront”?")).not.toBeNull()
    expect(within(confirm).getByText(/Its chat is removed/)).not.toBeNull()
    expect(within(confirm).getByText("Checkout polish")).not.toBeNull()
    expect(within(confirm).queryByText(/changes on this canvas/)).toBeNull()
    expect(onRemoveRepo).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }))

    await waitFor(() =>
      expect(onRemoveRepo).toHaveBeenCalledWith("r1", {
        deleteBranchesOnRemote: false,
      })
    )
  })

  it("confirms removing a customized repository, saying its changes are lost", async () => {
    const customized = {
      ...STOREFRONT,
      id: "r5",
      devScript: "pnpm dev --turbo",
    }
    const { onRemoveRepo } = renderDialog([customized, DOCS])
    await screen.findByRole("img", { name: "Customized for this canvas" })

    fireEvent.click(screen.getByRole("button", { name: "Remove storefront" }))

    const confirm = await screen.findByRole("alertdialog")
    expect(
      within(confirm).getByText(
        "The repository is removed from this canvas. Its changes on this canvas are lost."
      )
    ).not.toBeNull()
    expect(onRemoveRepo).not.toHaveBeenCalled()
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
    // The hosted picker (tests run the hosted build): straight to GitHub,
    // no Open folder.
    // The server's upsert: saving the repository you already have keeps its id.
    vi.mocked(saveRepository).mockImplementation(async (r: RepoConfig) =>
      REPOSITORIES.map((x) => (x.id === r.id ? r : x))
    )
    const { onSwitchOn } = renderDialog(undefined, MEMORIES, {
      policy: hostedLinkPolicy,
    })

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
      name: "Edit repository",
    })
    fireEvent.change(within(form).getByLabelText("Name"), {
      target: { value: "web" },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Save" }))

    expect(onUpdateRepo).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ name: "web", devScript: "pnpm dev" })
    )
  })

  it("saves an edit to this canvas only while the box is unticked", async () => {
    const { onUpdateRepo } = renderDialog()
    await waitFor(() => expect(listRepositories).toHaveBeenCalled())
    await screen.findByRole("button", { name: "Add api" })

    fireEvent.click(screen.getByRole("button", { name: "Edit storefront" }))
    const form = await screen.findByRole("dialog", {
      name: "Edit repository",
    })
    const box = within(form).getByRole("checkbox", {
      name: "Also update Settings and my other canvases",
    })
    expect(box.getAttribute("aria-checked")).toBe("false")
    fireEvent.change(within(form).getByLabelText("Run script"), {
      target: { value: "pnpm dev --turbo" },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Save" }))

    expect(onUpdateRepo).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ devScript: "pnpm dev --turbo" })
    )
    expect(saveRepositoryToAll).not.toHaveBeenCalled()
  })

  it("saves to Settings and every canvas when the box is ticked", async () => {
    const { onUpdateRepo } = renderDialog()
    await waitFor(() => expect(listRepositories).toHaveBeenCalled())
    await screen.findByRole("button", { name: "Add api" })

    fireEvent.click(screen.getByRole("button", { name: "Edit storefront" }))
    const form = await screen.findByRole("dialog", {
      name: "Edit repository",
    })
    fireEvent.change(within(form).getByLabelText("Run script"), {
      target: { value: "pnpm dev --turbo" },
    })
    fireEvent.click(
      within(form).getByRole("checkbox", {
        name: "Also update Settings and my other canvases",
      })
    )
    fireEvent.click(within(form).getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(saveRepositoryToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "cfg-storefront",
          repoFullName: "acme/storefront",
          devScript: "pnpm dev --turbo",
        })
      )
    )
    await waitFor(() =>
      expect(onUpdateRepo).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ devScript: "pnpm dev --turbo" })
      )
    )
  })

  it("offers no save to all for a repository that isn't in your Settings", async () => {
    renderDialog()
    await waitFor(() => expect(listRepositories).toHaveBeenCalled())
    await screen.findByRole("button", { name: "Add api" })

    fireEvent.click(screen.getByRole("button", { name: "Edit docs" }))
    const form = await screen.findByRole("dialog", {
      name: "Edit repository",
    })
    expect(
      within(form).queryByRole("checkbox", {
        name: "Also update Settings and my other canvases",
      })
    ).toBeNull()
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
      name: "Edit repository",
    })
    fireEvent.click(
      within(form).getByRole("button", { name: "Reset to Settings" })
    )

    // The values are stored first; the doc follows (#1476).
    await waitFor(() =>
      expect(onUpdateRepo).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          devScript: "pnpm dev",
          setupScript: "pnpm install",
        })
      )
    )
  })

  describe("env vars (#1416)", () => {
    // Env vars are a hosted field, and tests run the hosted build.

    const WITH_ENV = {
      ...DOCS,
      envVarNames: ["API_URL", "STRIPE_KEY"],
      envVarsDigest: "d1",
    }

    async function openDocs(canReveal: boolean) {
      const handlers = renderDialog([STOREFRONT, WITH_ENV], MEMORIES, {
        canReveal,
        policy: hostedLinkPolicy,
      })
      fireEvent.click(screen.getByRole("button", { name: "Edit docs" }))
      const form = await screen.findByRole("dialog", {
        name: "Edit repository",
      })
      return { ...handlers, form }
    }

    it("shows another member the names, never the values, and saves theirs over them", async () => {
      const { form, onUpdateRepo } = await openDocs(false)
      const field = within(form).getByLabelText("Environment variables")

      expect(field).toHaveProperty("value", "")
      expect(field.getAttribute("placeholder")).toBe(
        "API_URL=••••••\nSTRIPE_KEY=••••••"
      )
      expect(revealCanvasRepoEnv).not.toHaveBeenCalled()
      expect(form.textContent).toContain(
        "Only the person who added this repository can see the values"
      )

      fireEvent.change(field, { target: { value: "STRIPE_KEY=sk_test_mine" } })
      fireEvent.click(within(form).getByRole("button", { name: "Save" }))

      await waitFor(() =>
        expect(saveCanvasRepoEnv).toHaveBeenCalledWith(
          "room-1",
          "r2",
          "STRIPE_KEY=sk_test_mine"
        )
      )
      // The server stores the value and names it in the doc; the form's own
      // write never carries it.
      await waitFor(() => expect(onUpdateRepo).toHaveBeenCalled())
      expect(JSON.stringify(onUpdateRepo.mock.calls)).not.toContain(
        "sk_test_mine"
      )
    })

    it("locks the adder's field until they reveal the values, and hides them again", async () => {
      const { form } = await openDocs(true)
      expect(
        within(form).getByLabelText("Environment variables")
      ).toHaveProperty("disabled", true)
      expect(revealCanvasRepoEnv).not.toHaveBeenCalled()
      expect(form.textContent).toContain("Only you can see the values")
      fireEvent.click(
        within(form).getByRole("button", { name: "Reveal values" })
      )
      const field = within(form).getByLabelText("Environment variables")
      await waitFor(() =>
        expect(field).toHaveProperty(
          "value",
          "API_URL=https://api.test\nSTRIPE_KEY=sk_live_1"
        )
      )
      expect(revealCanvasRepoEnv).toHaveBeenCalledWith("room-1", "r2")

      fireEvent.change(field, { target: { value: "API_URL=https://api.test" } })

      // Hide masks and locks the field again, keeping the edit; showing it
      // again doesn't go back to the server.
      fireEvent.click(within(form).getByRole("button", { name: "Hide values" }))
      expect(field).toHaveProperty("value", "")
      expect(field).toHaveProperty("disabled", true)
      expect(field.getAttribute("placeholder")).toBe("API_URL=••••••")
      fireEvent.click(
        within(form).getByRole("button", { name: "Reveal values" })
      )
      expect(field).toHaveProperty("value", "API_URL=https://api.test")
      expect(revealCanvasRepoEnv).toHaveBeenCalledTimes(1)

      fireEvent.click(within(form).getByRole("button", { name: "Save" }))
      await waitFor(() =>
        expect(saveCanvasRepoEnv).toHaveBeenLastCalledWith(
          "room-1",
          "r2",
          "API_URL=https://api.test"
        )
      )
    })
  })

  it("offers no reset when the repository matches its Settings", async () => {
    renderDialog()
    await waitFor(() => expect(listRepositories).toHaveBeenCalled())
    await screen.findByRole("button", { name: "Add api" })

    expect(
      screen.queryByRole("img", { name: "Customized for this canvas" })
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Edit storefront" }))
    const form = await screen.findByRole("dialog", {
      name: "Edit repository",
    })
    expect(
      within(form).queryByRole("button", { name: "Reset to Settings" })
    ).toBeNull()
  })

  describe("on a shared hosted canvas", () => {
    const renderHosted = (repos?: RepoData[]) =>
      renderDialog(repos, MEMORIES, { policy: hostedLinkPolicy })

    it("splits the list into On this canvas and Your other repositories", async () => {
      renderHosted([STOREFRONT, DOCS, MIAS_WEB])
      await screen.findByRole("button", { name: "Add api" })

      const names = (label: string) =>
        within(screen.getByRole("region", { name: label }))
          .getAllByRole("button", { name: /^(Add|Remove) / })
          .map((s) => s.getAttribute("aria-label"))
      expect(names("On this canvas")).toEqual([
        "Remove docs",
        "Remove storefront",
        "Remove web",
      ])
      expect(names("Your other repositories")).toEqual(["Add api"])
      expect(screen.queryByRole("switch")).toBeNull()
    })

    it("adds one of your repositories", async () => {
      const { onSwitchOn } = renderHosted()

      fireEvent.click(await screen.findByRole("button", { name: "Add api" }))

      expect(onSwitchOn).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cfg-api" })
      )
    })

    it("confirms removing even a repository no workspace uses", async () => {
      const { onRemoveRepo } = renderHosted()

      fireEvent.click(
        await screen.findByRole("button", { name: "Remove docs" })
      )

      const confirm = await screen.findByRole("alertdialog")
      expect(within(confirm).getByText("Remove “docs”?")).not.toBeNull()
      expect(
        within(confirm).getByText(
          "It's removed for everyone on this canvas, with any changes made here."
        )
      ).not.toBeNull()
      expect(onRemoveRepo).not.toHaveBeenCalled()
      fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }))

      await waitFor(() =>
        expect(onRemoveRepo).toHaveBeenCalledWith("r2", {
          deleteBranchesOnRemote: false,
        })
      )
    })

    it("confirms removing a repository its workspaces use", async () => {
      const { onRemoveRepo } = renderHosted()

      fireEvent.click(
        await screen.findByRole("button", { name: "Remove storefront" })
      )

      const confirm = await screen.findByRole("alertdialog")
      expect(within(confirm).getByText("Remove “storefront”?")).not.toBeNull()
      fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }))

      await waitFor(() =>
        expect(onRemoveRepo).toHaveBeenCalledWith("r1", {
          deleteBranchesOnRemote: false,
        })
      )
    })

    it("says who added a teammate's repository when removing it", async () => {
      renderHosted([STOREFRONT, DOCS, MIAS_WEB])
      await screen.findByText("Added by Mia")

      fireEvent.click(screen.getByRole("button", { name: "Remove web" }))

      const confirm = await screen.findByRole("alertdialog")
      expect(
        within(confirm).getByText(
          "It's removed for everyone on this canvas, with any changes made here. Mia added it."
        )
      ).not.toBeNull()
    })

    it("names a teammate who added a repository", async () => {
      renderHosted([STOREFRONT, DOCS, MIAS_WEB])

      expect(await screen.findByText("Added by Mia")).not.toBeNull()
      // Yours goes unnamed, and nobody recorded who added docs.
      expect(screen.getAllByText(/^Added by/)).toHaveLength(1)
    })

    it("keeps every edit on this canvas, with no dot, Reset or Save to all", async () => {
      const { onUpdateRepo } = renderHosted([
        { ...STOREFRONT, devScript: "pnpm dev --turbo" },
        MIAS_WEB,
      ])
      await screen.findByText("Added by Mia")
      expect(
        screen.queryByRole("img", { name: "Customized for this canvas" })
      ).toBeNull()

      fireEvent.click(screen.getByRole("button", { name: "Edit storefront" }))
      const form = await screen.findByRole("dialog", {
        name: "Edit repository",
      })
      expect(
        within(form).queryByRole("checkbox", {
          name: "Also update Settings and my other canvases",
        })
      ).toBeNull()
      expect(
        within(form).queryByRole("button", { name: "Reset to Settings" })
      ).toBeNull()
      fireEvent.change(within(form).getByLabelText("Run script"), {
        target: { value: "pnpm dev" },
      })
      fireEvent.click(within(form).getByRole("button", { name: "Save" }))

      expect(onUpdateRepo).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ devScript: "pnpm dev" })
      )
      expect(saveRepositoryToAll).not.toHaveBeenCalled()
    })
  })

  describe("Memory", () => {
    it("lists each entry with who saved it", () => {
      renderDialog(undefined, [
        ...MEMORIES,
        {
          id: "mem-2",
          text: "Staging deploys on merge.",
          source: "member",
          createdAt: 2,
          updatedAt: 2,
        },
      ])
      openMemory()

      expect(screen.getByText("Use pnpm, never npm.")).not.toBeNull()
      // Saved by the Coordinator before #1513, so it says `coordinator`.
      expect(screen.getByText("Saved by agent")).not.toBeNull()
      expect(screen.getByText("Added in settings")).not.toBeNull()
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

  describe("Files (#1517)", () => {
    const entry = (
      path: string,
      over: Partial<FileEntryData> = {}
    ): FileEntryData => ({
      id: path,
      path,
      kind: "file",
      size: 2150,
      mediaType: "text/markdown",
      addedBy: "agent",
      addedById: "chat-1",
      blobKey: `canvas/room-1/${path}`,
      createdAt: 1,
      updatedAt: 1,
      ...over,
    })
    const folder = (path: string) =>
      entry(path, { kind: "folder", size: 0, mediaType: "", blobKey: "" })
    // research/ holds interviews/ (one file) and two files; one file at the top.
    const FILES = [
      entry("zebra.md", { addedBy: "member", addedById: "zack" }),
      folder("research"),
      folder("research/interviews"),
      entry("research/interviews/sam.md"),
      entry("research/pricing.pdf", {
        mediaType: "application/pdf",
        size: 880 * 1024,
        addedBy: "member",
        addedById: "sam",
      }),
      entry("research/notes.md"),
    ]

    const openFiles = (files = FILES) => {
      const handlers = renderDialog(undefined, undefined, { files })
      fireEvent.click(screen.getByRole("button", { name: "Files" }))
      return handlers
    }
    const rowNames = () =>
      screen
        .getAllByRole("button", { name: /^More actions for / })
        .map((b) =>
          b.getAttribute("aria-label")!.replace("More actions for ", "")
        )
    const menu = async (name: string) => {
      fireEvent.pointerDown(
        screen.getByRole("button", { name: `More actions for ${name}` }),
        { button: 0, ctrlKey: false }
      )
      return screen.findByRole("menu")
    }

    afterEach(() => vi.unstubAllGlobals())

    it("lists folders first with their item count, collapsed", () => {
      openFiles()

      expect(rowNames()).toEqual(["research", "zebra.md"])
      expect(screen.getByText("3 items")).toBeTruthy()
      expect(screen.getByText("2.1 KB · Added by you")).toBeTruthy()
    })

    it("expands and collapses a folder, folders first inside it too", () => {
      openFiles()

      fireEvent.click(screen.getByRole("button", { name: "Expand research" }))
      expect(rowNames()).toEqual([
        "research",
        "interviews",
        "notes.md",
        "pricing.pdf",
        "zebra.md",
      ])
      expect(screen.getByText("880.0 KB · Added by a member")).toBeTruthy()
      expect(screen.getByText("2.1 KB · Saved by agent")).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: "Collapse research" }))
      expect(rowNames()).toEqual(["research", "zebra.md"])
    })

    it("offers people only Open and Delete", async () => {
      openFiles()

      const items = within(await menu("zebra.md")).getAllByRole("menuitem")
      expect(items.map((i) => i.textContent)).toEqual(["Open", "Delete"])
      expect(
        screen.queryByRole("button", { name: /upload|new folder|rename|move/i })
      ).toBeNull()
    })

    it("opens a file on the breadcrumb, not in a second dialog, and goes back", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("# Zebra notes"))
      )
      openFiles()

      fireEvent.click(
        within(await menu("zebra.md")).getByRole("menuitem", { name: "Open" })
      )

      expect(await screen.findByText("# Zebra notes")).toBeTruthy()
      expect(fetch).toHaveBeenCalledWith("/api/canvas-files/room-1/zebra.md")
      expect(screen.getAllByRole("dialog")).toHaveLength(1)
      const crumbs = screen.getByRole("navigation", { name: "breadcrumb" })
      expect(
        within(crumbs).getByText("zebra.md").getAttribute("aria-current")
      ).toBe("page")

      fireEvent.click(within(crumbs).getByRole("button", { name: "Files" }))
      expect(rowNames()).toEqual(["research", "zebra.md"])
    })

    it("confirms deleting a file with its name", async () => {
      const { deleteFile } = openFiles()

      fireEvent.click(
        within(await menu("zebra.md")).getByRole("menuitem", { name: "Delete" })
      )
      const confirm = await screen.findByRole("alertdialog")
      expect(within(confirm).getByText("Delete “zebra.md”?")).toBeTruthy()
      expect(deleteFile).not.toHaveBeenCalled()

      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
      await waitFor(() =>
        expect(deleteFile).toHaveBeenCalledWith("room-1", "zebra.md")
      )
    })

    it("confirms deleting a folder with how many items go with it", async () => {
      const { deleteFile } = openFiles()

      fireEvent.click(
        within(await menu("research")).getByRole("menuitem", { name: "Delete" })
      )
      const confirm = await screen.findByRole("alertdialog")
      expect(within(confirm).getByText("Delete “research”?")).toBeTruthy()
      expect(within(confirm).getByText(/The 4 items in it go too/)).toBeTruthy()

      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
      await waitFor(() =>
        expect(deleteFile).toHaveBeenCalledWith("room-1", "research")
      )
    })

    it("says so when the canvas has no files", () => {
      openFiles([])

      expect(screen.getByText("No files yet")).toBeTruthy()
    })
  })
})
