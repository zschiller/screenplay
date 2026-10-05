// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { BranchData, RepoData } from "@/lib/types"

// The create dialog's base picker lists the remote's branches; none here.
vi.mock("@/lib/github-actions", () => ({
  listRepoBranches: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/lib/yjs/react", () => ({ useChatSessions: () => [] }))
// Each Workspace's state comes from its chats and plans; the rows under test
// need only the Branch's own status, and one Workspace needing you.
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
  useGitHubTokenAvailable: () => true,
  useGitHubTokenProbe: () => true,
}))

import { ChatsMenuButton, ChatsMenuProvider } from "./chats-menu"

// Radix's Popover and cmdk use pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver.
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

const REPO = {
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
} as RepoData

function branch(over: Partial<BranchData>): BranchData {
  return {
    id: "b1",
    repoId: "r1",
    ref: "checkout-polish",
    title: "Checkout polish",
    status: "running",
    createdAt: 1,
    colorIndex: 0,
    ...over,
  } as BranchData
}

function renderMenu(
  branches: BranchData[],
  { repos = [REPO] }: { repos?: RepoData[] } = {}
) {
  const noop = () => {}
  const onSelectWorkspace = vi.fn()
  render(
    <ChatsMenuProvider
      userId="u1"
      roomId="room1"
      repos={repos}
      branches={branches}
      iframeLayers={[]}
      diffStats={new Map()}
      branchPrs={new Map()}
      onSelectWorkspace={onSelectWorkspace}
      onSelectSketchChat={noop}
      onRenameSketchChat={noop}
      onDeleteSketchChat={noop}
      onRestartDevServer={noop}
      onCreatePr={noop}
      onRefreshBranch={noop}
      onRecreateBranch={noop}
      onRetryBranch={noop}
      onMarkBranchDone={noop}
      onReopenBranch={noop}
      onRemoveBranch={noop}
      onPlayBranch={noop}
      onShowRoutes={noop}
      onUpdateBranch={noop}
    >
      <ChatsMenuButton />
    </ChatsMenuProvider>
  )
  return { onSelectWorkspace }
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Chats" }))
  const menu = document.querySelector<HTMLElement>("[data-chats-menu]")
  if (!menu) throw new Error("Chats menu didn't open")
  return menu
}

const rowTexts = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>("[cmdk-item]")].map(
    (row) => row.textContent ?? ""
  )

describe("Chats menu", () => {
  it("is labelled Chats and lists each chat by title, without the Coordinator", () => {
    renderMenu([
      branch({}),
      branch({
        id: "b2",
        ref: "empty-cart-state",
        title: "Empty cart state",
        createdAt: 2,
      }),
    ])
    const menu = openMenu()
    expect(within(menu).getByPlaceholderText("Search chats…")).toBeTruthy()
    const rows = rowTexts(menu)
    // It opens from the Coordinator's header, so it doesn't list it.
    expect(menu.textContent).not.toContain("Coordinator")
    // Grouped by state, most recent activity first.
    expect(rows[0]).toContain("Empty cart state")
    expect(rows[1]).toContain("Checkout polish")
    // A chat reads by its title, never its branch.
    expect(menu.textContent).not.toContain("checkout-polish")
    expect(menu.textContent).not.toContain("empty-cart-state")
  })

  it("shows each chat's Workspace state icon", () => {
    renderMenu([branch({ status: "error" })])
    const menu = openMenu()
    const row = [...menu.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
      (r) => r.textContent?.includes("Checkout polish")
    )
    // A failed setup's icon is the warning that opens the error.
    expect(
      within(row!).getByRole("button", { name: /setup failed/i })
    ).toBeTruthy()
  })

  it("puts the needs-you dot on the button while a Workspace needs you", () => {
    renderMenu([branch({ status: "error" })])
    expect(
      screen
        .getByRole("button", { name: "Chats" })
        .getAttribute("aria-description")
    ).toBe("A chat needs you")
  })

  it("switches the panel to the picked chat", () => {
    const { onSelectWorkspace } = renderMenu([branch({})])
    fireEvent.click(within(openMenu()).getByText("Checkout polish"))
    expect(onSelectWorkspace).toHaveBeenCalledWith("b1", {
      expandPanel: false,
    })
  })

  it("has only the search field above the list: chats start from the canvas", () => {
    renderMenu([branch({})])
    const menu = openMenu()
    fireEvent.change(within(menu).getByPlaceholderText("Search chats…"), {
      target: { value: "billing" },
    })
    expect(within(menu).getByText("No matches.")).toBeTruthy()
    expect(within(menu).queryByRole("button", { name: "New chat" })).toBeNull()
  })

  it("gives the first section its own heading", () => {
    renderMenu([branch({})])
    const heading = openMenu().querySelector("[cmdk-group-heading]")
    expect(heading?.textContent).toBe("Idle")
  })

  it("says there are no chats yet on a canvas with none", () => {
    renderMenu([], { repos: [] })
    expect(within(openMenu()).getByText("No chats yet.")).toBeTruthy()
  })
})
