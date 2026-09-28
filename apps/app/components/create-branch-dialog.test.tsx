// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { CreateBranchDialog } from "@/components/create-branch-dialog"
import type { RepoData } from "@/lib/types"

// The base picker reaches GitHub through `github-actions`, which imports the
// server-only stack. It only mounts when its popover opens, so stub it.
vi.mock("@/lib/github-actions", () => ({
  listRepoBranches: vi.fn().mockResolvedValue([]),
}))

// Radix menus position with floating-ui (ResizeObserver) and use pointer
// capture, neither of which jsdom implements.
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

function makeRepo(id: string, name: string, defaultBranch: string): RepoData {
  return {
    id,
    name,
    repoFullName: `acme/${id}`,
    repoOwner: "acme",
    repoName: id,
    defaultBranch,
    cloneUrl: `https://github.com/acme/${id}.git`,
    setupScript: "",
    devScript: "",
    devServerPort: 3000,
    envVars: "",
    createdAt: 0,
  }
}

const web = makeRepo("web", "web", "main")
const api = makeRepo("api", "api", "trunk")

function renderDialog(repos: RepoData[], repoId: string) {
  const onSubmit = vi.fn()
  render(
    <CreateBranchDialog
      open
      onOpenChange={() => {}}
      repos={repos}
      repoId={repoId}
      markdownLayers={[]}
      onSubmit={onSubmit}
    />
  )
  return { dialog: screen.getByRole("dialog"), onSubmit }
}

describe("Create workspaces' repository chip (#884)", () => {
  it("never mentions the repository on a canvas with one", () => {
    const { dialog } = renderDialog([web], web.id)
    expect(within(dialog).queryByTitle("Choose the repository")).toBeNull()
  })

  it("starts on the given repository and its default branch", () => {
    const { dialog } = renderDialog([web, api], api.id)
    const chip = within(dialog).getByTitle("Choose the repository")
    expect(chip.textContent).toContain("api")
    expect(within(dialog).queryByText("trunk")).not.toBeNull()
  })

  it("switching repository resets the base and creates in the new one", () => {
    const { dialog, onSubmit } = renderDialog([web, api], web.id)
    fireEvent.keyDown(within(dialog).getByTitle("Choose the repository"), {
      key: "Enter",
    })
    fireEvent.click(screen.getByRole("menuitemradio", { name: "api" }))

    expect(within(dialog).queryByText("trunk")).not.toBeNull()
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Create workspace/ })
    )
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ repoId: api.id, baseBranch: "trunk" }),
    ])
  })
})
