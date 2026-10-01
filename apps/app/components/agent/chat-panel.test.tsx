// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"

import type { BranchData, ChatSessionData, TerminalTabData } from "@/lib/types"

// The Coordinator's body talks to the Room; the panel only decides what it gets.
const coordinatorChat = vi.fn((_props: { chatSession?: ChatSessionData }) => (
  <div data-testid="coordinator-chat" />
))
vi.mock("./coordinator-chat", () => ({
  CoordinatorChat: (props: { chatSession?: ChatSessionData }) =>
    coordinatorChat(props),
}))
vi.mock("./chats-menu", () => ({
  ChatsMenuButton: () => <button type="button">Chats</button>,
}))
// The Workspace panel's bodies talk to the sandbox and the chat store; the
// panel only decides which one shows where.
vi.mock("./agent-chat", () => ({
  AgentChat: (props: { chatId: string; onOpenWorkspaceChat?: () => void }) => (
    <div data-testid="agent-chat" data-chat-id={props.chatId}>
      {props.onOpenWorkspaceChat && (
        <button type="button" onClick={props.onOpenWorkspaceChat}>
          Open chat
        </button>
      )}
    </div>
  ),
}))
vi.mock("./logs-panel", () => ({
  LogsPanel: () => <div data-testid="dev-server-output" />,
}))
vi.mock("./terminal-tab", () => ({
  TerminalTab: (props: { sessionId: string }) => (
    <div data-testid="shell" data-session={props.sessionId} />
  ),
}))
vi.mock("@/lib/auth-client", () => ({
  useAppSession: () => ({ data: { user: { id: "user-1" } } }),
}))
vi.mock("@/hooks/use-installed-harnesses", () => ({
  useInstalledHarnesses: () => [],
}))
vi.mock("@/hooks/use-workspace-states", () => ({
  useWorkspaceStates: () => () => "idle",
}))
vi.mock("@/components/workspace-hover-card", () => ({
  WorkspaceHoverCard: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/workspace-mention", () => ({
  WorkspaceMention: ({ branch }: { branch: BranchData }) => (
    <span>{branch.title}</span>
  ),
}))

import { ChatPanel } from "./chat-panel"

beforeAll(() => {
  // The Resizable measures its group; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  cleanup()
  coordinatorChat.mockClear()
  window.localStorage.clear()
})

const noop = () => {}

function renderRoomPanel(onCollapse = vi.fn()) {
  const roomChat: ChatSessionData = {
    id: "room-chat-room-1",
    label: "Coordinator",
    createdAt: 1,
  }
  const otherChat: ChatSessionData = {
    id: "chat-2",
    label: "Untitled",
    createdAt: 2,
    branchId: "b1",
  }
  render(
    <ChatPanel
      target={{ kind: "room" }}
      chatSessions={[otherChat, roomChat]}
      selectedChatId={null}
      roomId="room-1"
      onSelectChat={noop}
      onCreateChat={noop}
      onRemoveChat={noop}
      onPlanModeChange={noop}
      onModelChange={noop}
      onCollapse={onCollapse}
      onOpenWorkspace={noop}
    />
  )
  return { roomChat, onCollapse }
}

describe("ChatPanel with the Room target", () => {
  it("shows the Coordinator chat under the shared header", () => {
    const { roomChat } = renderRoomPanel()
    expect(screen.getByRole("heading", { name: "Coordinator" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Chats" })).toBeTruthy()
    expect(screen.getByTestId("coordinator-chat")).toBeTruthy()
    expect(coordinatorChat.mock.calls.at(-1)?.[0].chatSession).toBe(roomChat)
    // One chat per canvas: no tab strip.
    expect(screen.queryByRole("tablist")).toBeNull()
  })

  it("collapses from the header's one Collapse chat button", () => {
    const { onCollapse } = renderRoomPanel()
    const buttons = screen.getAllByRole("button", { name: /Collapse chat/ })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onCollapse).toHaveBeenCalledOnce()
  })
})

const workspace = {
  id: "ws-1",
  repoId: "repo-1",
  title: "Checkout polish",
  branch: "checkout-polish",
  sandboxName: "sb-1",
  status: "running",
} as unknown as BranchData

function shell(id: string, label: string, createdAt: number): TerminalTabData {
  return { id, branchId: "ws-1", terminalSessionId: id, label, createdAt }
}

function renderWorkspacePanel(
  options: {
    chatSessions?: ChatSessionData[]
    terminalTabs?: TerminalTabData[]
    selectedChatId?: string | null
    logsRequest?: { agentId: string; nonce: number } | null
  } = {}
) {
  const onSelectChat = vi.fn()
  const onCloseTerminal = vi.fn()
  const props = {
    target: { kind: "agent" as const, agent: workspace },
    chatSessions: options.chatSessions ?? [
      {
        id: "chat-1",
        label: "Checkout polish",
        createdAt: 2,
        branchId: "ws-1",
      },
    ],
    terminalTabs: options.terminalTabs ?? [
      shell("s1", "Shell", 1),
      shell("s2", "Shell 2", 2),
    ],
    selectedChatId: options.selectedChatId ?? null,
    roomId: "room-1",
    onSelectChat,
    onCreateChat: noop,
    onCreateTerminal: () => "new",
    onCloseTerminal,
    onRemoveChat: noop,
    onPlanModeChange: noop,
    onModelChange: noop,
    onCollapse: noop,
    logsRequest: options.logsRequest ?? null,
  }
  const view = render(<ChatPanel {...props} />)
  return { ...view, props, onSelectChat, onCloseTerminal }
}

// Closed, the pane's tab strip rests as the footnote under the composer.
const paneState = () =>
  screen
    .getByRole("tablist", { name: "Terminals" })
    .closest<HTMLElement>("[data-pane]")!.dataset.pane
const terminalName = (name: string) => screen.getByRole("tab", { name })

describe("ChatPanel with a Workspace target", () => {
  it("shows the chat with no tab strip, and a footnote naming its terminals", () => {
    renderWorkspacePanel()
    expect(screen.getByTestId("agent-chat").dataset.chatId).toBe("chat-1")
    expect(screen.queryByRole("tab", { name: /Sandbox logs/ })).toBeNull()
    expect(paneState()).toBe("closed")
    const names = within(screen.getByRole("tablist", { name: "Terminals" }))
      .getAllByRole("tab")
      .map((b) => b.textContent)
    expect(names).toEqual(["Dev server", "Shell", "Shell 2"])
  })

  it("opens the pane on the clicked terminal, and the caret closes it", () => {
    renderWorkspacePanel()
    fireEvent.click(terminalName("Shell"))
    expect(paneState()).toBe("open")
    expect(
      screen.getByRole("tab", { name: "Shell" }).getAttribute("aria-selected")
    ).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: /Hide terminal/ }))
    expect(paneState()).toBe("closed")
  })

  it("toggles with ⌃`", () => {
    renderWorkspacePanel()
    act(() => {
      fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true })
    })
    expect(paneState()).toBe("open")
    expect(
      screen
        .getByRole("tab", { name: "Dev server" })
        .getAttribute("aria-selected")
    ).toBe("true")
    act(() => {
      fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true })
    })
    expect(paneState()).toBe("closed")
  })

  it("remembers that the pane is open, across Workspaces and reloads", () => {
    const first = renderWorkspacePanel()
    fireEvent.click(terminalName("Dev server"))
    first.unmount()
    renderWorkspacePanel({ terminalTabs: [] })
    expect(paneState()).toBe("open")
    expect(screen.getByRole("tab", { name: "Dev server" })).toBeTruthy()
  })

  it("never offers to close Dev server", () => {
    renderWorkspacePanel()
    fireEvent.click(terminalName("Dev server"))
    expect(
      screen.getAllByRole("button", { name: "Close terminal" })
    ).toHaveLength(2)
  })

  it("lands on the neighbour when the shown shell closes", () => {
    const { onCloseTerminal, rerender, props } = renderWorkspacePanel()
    fireEvent.click(terminalName("Shell"))
    // An idle sandbox is still "running" here, so the close asks the server
    // what's running first; a non-running one closes at once.
    const stopped = { ...workspace, status: "stopped" } as BranchData
    rerender(
      <ChatPanel {...props} target={{ kind: "agent", agent: stopped }} />
    )
    fireEvent.click(
      screen.getAllByRole("button", { name: "Close terminal" })[0]!
    )
    expect(onCloseTerminal).toHaveBeenCalledWith("s1")
    rerender(
      <ChatPanel
        {...props}
        target={{ kind: "agent", agent: stopped }}
        terminalTabs={[shell("s2", "Shell 2", 2)]}
      />
    )
    expect(
      screen.getByRole("tab", { name: "Shell 2" }).getAttribute("aria-selected")
    ).toBe("true")
  })

  it("opens the pane on Dev server for a frame's Open logs", () => {
    const { rerender, props } = renderWorkspacePanel()
    expect(paneState()).toBe("closed")
    rerender(
      <ChatPanel {...props} logsRequest={{ agentId: "ws-1", nonce: 1 }} />
    )
    expect(paneState()).toBe("open")
    expect(
      screen
        .getByRole("tab", { name: "Dev server" })
        .getAttribute("aria-selected")
    ).toBe("true")
  })

  it("keeps earlier chats behind Chat history, opened read-only", () => {
    const { onSelectChat, rerender, props } = renderWorkspacePanel({
      chatSessions: [
        { id: "old", label: "Old", createdAt: 1, branchId: "ws-1" },
        {
          id: "chat-1",
          label: "Checkout polish",
          createdAt: 2,
          branchId: "ws-1",
        },
      ],
      selectedChatId: "chat-1",
    })
    expect(screen.getByRole("button", { name: "Chat history" })).toBeTruthy()
    rerender(<ChatPanel {...props} selectedChatId="old" />)
    const shown = screen
      .getAllByTestId("agent-chat")
      .filter((el) => !el.parentElement?.classList.contains("hidden"))
    expect(shown.map((el) => el.dataset.chatId)).toEqual(["old"])
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }))
    expect(onSelectChat).toHaveBeenCalledWith("chat-1")
  })

  it("has no Chat history without earlier chats", () => {
    renderWorkspacePanel()
    expect(screen.queryByRole("button", { name: "Chat history" })).toBeNull()
  })
})
