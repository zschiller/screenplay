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
import type { BranchData, RepoData } from "@/lib/types"

// The Open existing git branch picker lists the remote's branches; none here.
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
// GitHub is reachable, so the menu offers Create pull request.
vi.mock("@/hooks/use-github-token", () => ({
  useGitHubTokenAvailable: () => true,
}))

import { ChatsMenuProvider, useChatsMenu } from "./chats-menu"
import { WorkspaceHeaderTitle, WorkspaceMenuItems } from "./workspace-menu"

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

// Stands in for a frame's Workspace submenu asking for a rename.
function AskRename() {
  const menu = useChatsMenu()
  return (
    <button type="button" onClick={() => menu?.requestRename("b1")}>
      Ask rename
    </button>
  )
}

function renderHeader(b: BranchData, { provider = true } = {}) {
  const noop = () => {}
  const onSelectWorkspace = vi.fn()
  const onUpdateBranch = vi.fn()
  const title = <WorkspaceHeaderTitle branch={b} />
  render(
    provider ? (
      <ChatsMenuProvider
        userId="u1"
        roomId="room1"
        repos={[REPO]}
        branches={[b]}
        markdownLayers={[]}
        iframeLayers={[]}
        diffStats={new Map()}
        branchPrs={new Map()}
        onSelectWorkspace={onSelectWorkspace}
        onSelectSketchChat={noop}
        onCreateSketchChat={noop}
        onRenameSketchChat={noop}
        onDeleteSketchChat={noop}
        onCreateBranchFromGitBranch={noop}
        onCreateWorkspace={noop}
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
        onUpdateBranch={onUpdateBranch}
      >
        <AskRename />
        {title}
      </ChatsMenuProvider>
    ) : (
      title
    )
  )
  return { onSelectWorkspace, onUpdateBranch }
}

function editingField() {
  const field = document.querySelector<HTMLElement>(
    "[data-editable-text=editing]"
  )
  if (!field) throw new Error("Not renaming")
  return field
}

const openOptions = () =>
  fireEvent.keyDown(screen.getByRole("button", { name: "Chat options" }), {
    key: "Enter",
  })

describe("Workspace chat header", () => {
  it("has a … with the Workspace's whole menu, the same as its Chats row", () => {
    renderHeader(branch({ previewDomain: "checkout.example.dev" }))
    openOptions()
    const items = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((item) => item.textContent)
    expect(items).toEqual([
      "Open prototype player",
      "Open in browser",
      "Show all routes",
      "Create pull request",
      "New chat from here…",
      "Rename",
      "Restart",
      "Mark as done",
      "Delete",
    ])
  })

  it("renames the title in place from the …", async () => {
    const { onUpdateBranch } = renderHeader(branch({}))
    openOptions()
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
    // The field opens once the menu has closed and handed focus back.
    const field = await waitFor(editingField)
    field.textContent = "Cart polish"
    fireEvent.keyDown(field, { key: "Enter" })
    expect(onUpdateBranch).toHaveBeenCalledWith("b1", { title: "Cart polish" })
  })

  it("opens the Delete confirm from the …", () => {
    renderHeader(branch({}))
    openOptions()
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("takes a rename asked for elsewhere (a frame's Workspace submenu)", () => {
    const { onSelectWorkspace } = renderHeader(branch({}))
    fireEvent.click(screen.getByRole("button", { name: "Ask rename" }))
    expect(onSelectWorkspace).toHaveBeenCalledWith("b1")
    expect(editingField().textContent).toBe("Checkout polish")
  })

  it("is the plain title with no … outside the Chats menu (the player)", () => {
    renderHeader(branch({}), { provider: false })
    expect(screen.getByText("Checkout polish")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Chat options" })).toBeNull()
  })
})

describe("WorkspaceMenuItems", () => {
  it("renders nothing outside the Chats menu", () => {
    const { container } = render(
      <WorkspaceMenuItems branchId="b1" onRename={() => {}} />
    )
    expect(container.innerHTML).toBe("")
  })
})
