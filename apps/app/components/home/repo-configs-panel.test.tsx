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
  deleteRepository: vi.fn(async () => []),
  repositoryCanvasCount: vi.fn(async () => 2),
  repositoryCanvasCounts: vi.fn(async () => ({ "cfg-web": 2 })),
}))

import {
  deleteRepository,
  listRepositories,
  repositoryCanvasCount,
  repositoryCanvasCounts,
  saveRepository,
} from "@/lib/repository-library/actions"
import {
  desktopLinkPolicy,
  hostedLinkPolicy,
  type RepositoryLinkPolicy,
} from "@/lib/repository-library/link-policy"
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

afterEach(() => {
  cleanup()
  vi.mocked(repositoryCanvasCount).mockClear()
  vi.mocked(repositoryCanvasCounts).mockClear()
  vi.mocked(deleteRepository).mockClear()
})

const WEB: RepoConfig = {
  id: "cfg-web",
  name: "",
  repoFullName: "acme/web",
  repoOwner: "acme",
  repoName: "web",
  defaultBranch: "main",
  cloneUrl: "https://github.com/acme/web.git",
  private: false,
  setupScript: "",
  devScript: "pnpm dev",
  devServerPort: 3000,
  envVars: "",
  createdAt: 1,
  updatedAt: 1,
}

/** Opens Delete on the one listed Repository; returns its confirm. */
async function deleteWeb(policy: RepositoryLinkPolicy) {
  vi.mocked(listRepositories).mockResolvedValueOnce([WEB])
  render(
    <RepoConfigsPanel
      header={(action) => <div>{action}</div>}
      policy={policy}
    />
  )
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: "More actions" }),
    { button: 0, ctrlKey: false }
  )
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
  return screen.findByRole("alertdialog")
}

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

describe("each row's canvases", () => {
  function renderWeb(policy: RepositoryLinkPolicy) {
    vi.mocked(listRepositories).mockResolvedValueOnce([WEB])
    render(
      <RepoConfigsPanel
        header={(action) => <div>{action}</div>}
        policy={policy}
      />
    )
  }

  it("on desktop, says how many canvases use it", async () => {
    renderWeb(desktopLinkPolicy)
    expect(await screen.findByText("On 2 canvases")).not.toBeNull()
    expect(screen.getByText("acme/web")).not.toBeNull()
  })

  it("on hosted, says nothing: canvases keep their own copy", async () => {
    renderWeb(hostedLinkPolicy)
    expect(await screen.findByText("acme/web")).not.toBeNull()
    expect(repositoryCanvasCounts).not.toHaveBeenCalled()
    expect(screen.queryByText(/^On \d/)).toBeNull()
  })
})

describe("deleting a repository", () => {
  it("on desktop, says how many canvases stop getting its edits", async () => {
    const confirm = await deleteWeb(desktopLinkPolicy)

    expect(repositoryCanvasCount).toHaveBeenCalledWith("cfg-web")
    expect(
      within(confirm).getByText(
        "It’s on 2 canvases. They keep their copy, but it stops getting your edits."
      )
    ).not.toBeNull()
  })

  it("on hosted, counts no canvases: each keeps its own copy", async () => {
    const confirm = await deleteWeb(hostedLinkPolicy)

    expect(repositoryCanvasCount).not.toHaveBeenCalled()
    expect(
      within(confirm).getByText("Canvases that use it keep their own copy.")
    ).not.toBeNull()
  })
})

describe("editing a repository", () => {
  const openEdit = async (policy: RepositoryLinkPolicy) => {
    vi.mocked(listRepositories).mockResolvedValueOnce([WEB])
    render(
      <RepoConfigsPanel
        header={(action) => <div>{action}</div>}
        policy={policy}
      />
    )
    fireEvent.click(await screen.findByRole("button", { name: /^Edit/ }))
    return screen.findByRole("dialog")
  }

  it("on desktop, says saving updates the canvases that use it", async () => {
    const form = await openEdit(desktopLinkPolicy)
    expect(
      within(form).getByText(
        "A repository’s scripts. Saving updates every canvas that uses it, unless it’s customized there."
      )
    ).not.toBeNull()
  })

  it("on hosted, says it applies when added", async () => {
    const form = await openEdit(hostedLinkPolicy)
    expect(
      within(form).getByText(
        "A repository’s scripts, applied when you add it to a canvas."
      )
    ).not.toBeNull()
  })
})
