// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { BranchData, RepoData } from "@/lib/types"

const BRANCH = {
  id: "b1",
  repoId: "r1",
  ref: "checkout-polish",
  title: "Checkout polish",
  status: "running",
  createdAt: 1,
} as BranchData
const REPO = { id: "r1", repoFullName: "acme/storefront" } as RepoData

vi.mock("@/lib/yjs/react", () => ({
  useBranches: () => [BRANCH],
  useRepos: () => [REPO],
}))
vi.mock("@/hooks/use-workspace-states", async () => {
  const { roomWorkspaceFacts, workspaceState } =
    await import("@/lib/branch/workspace-state")
  const room = roomWorkspaceFacts([], [])
  return {
    useWorkspaceStates: () => (branch: Parameters<typeof workspaceState>[0]) =>
      workspaceState(branch, room),
  }
})
// The Chats menu's provider, as the canvas mounts it; null in the player.
const chats = vi.hoisted(() => ({
  value: null as null | {
    onSelectWorkspace: (id: string) => void
    pagesOf: (id: string) => readonly string[]
  },
}))
vi.mock("@/components/agent/chats-menu", () => ({
  useChatsMenu: () => chats.value,
}))

import {
  WORKSPACE_HOVER_CARD_DELAY_MS,
  WorkspaceHoverCard,
} from "./workspace-hover-card"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  chats.value = null
  vi.useRealTimers()
})

function hoverCard(props: { openChat?: boolean } = {}) {
  vi.useFakeTimers()
  render(
    <WorkspaceHoverCard branchId="b1" {...props}>
      <a href="#ws">Checkout polish</a>
    </WorkspaceHoverCard>
  )
  fireEvent.pointerEnter(screen.getByText("Checkout polish"), {
    pointerType: "mouse",
  })
  act(() => vi.advanceTimersByTime(WORKSPACE_HOVER_CARD_DELAY_MS))
}

describe("WorkspaceHoverCard", () => {
  it("stays shut while the pointer only passes over", () => {
    vi.useFakeTimers()
    render(
      <WorkspaceHoverCard branchId="b1">
        <a href="#ws">Checkout polish</a>
      </WorkspaceHoverCard>
    )
    fireEvent.pointerEnter(screen.getByText("Checkout polish"), {
      pointerType: "mouse",
    })
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByText("acme/storefront")).toBeNull()
  })

  it("opens the Workspace's chat from Open chat, and closes", () => {
    const onSelectWorkspace = vi.fn()
    chats.value = { onSelectWorkspace, pagesOf: () => [] }
    hoverCard()
    expect(screen.getByText("acme/storefront")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }))
    expect(onSelectWorkspace).toHaveBeenCalledWith("b1")
    expect(screen.queryByText("acme/storefront")).toBeNull()
  })

  it("leaves Open chat out where the chat is already a click away", () => {
    chats.value = { onSelectWorkspace: vi.fn(), pagesOf: () => [] }
    hoverCard({ openChat: false })
    expect(screen.getByText("acme/storefront")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Open chat" })).toBeNull()
  })

  it("has no Open chat outside the canvas (play mode)", () => {
    hoverCard()
    expect(screen.getByText("acme/storefront")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Open chat" })).toBeNull()
  })

  it("lists every page the Workspace's Layers are on", () => {
    chats.value = {
      onSelectWorkspace: vi.fn(),
      pagesOf: (id) => (id === "b1" ? ["Homepage", "Explorations"] : []),
    }
    hoverCard()
    expect(screen.getByText("Pages")).toBeTruthy()
    expect(screen.getByText("Homepage, Explorations")).toBeTruthy()
  })
})
