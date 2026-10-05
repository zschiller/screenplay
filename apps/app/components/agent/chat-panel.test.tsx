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

import type { BranchPrInfo } from "@/lib/github-actions"
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
  useChatsMenu: () => null,
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
// The dev server's preview probe (#1342), scripted per test.
const preview = vi.hoisted(() => ({ failing: false }))
vi.mock("@/hooks/use-preview-failing", () => ({
  usePreviewFailing: () => preview.failing,
}))
// Whether the Workspace's repo can open a PR (a GitHub remote + a token).
const github = vi.hoisted(() => ({
  pr: "ready" as "ready" | "connect" | "none",
}))
vi.mock("@/hooks/use-github-token", () => ({
  useGitHubTokenProbe: () => github.pr !== "connect",
}))
vi.mock("@/lib/yjs/react", () => ({
  useChatSessions: () => [],
  useRepos: () =>
    github.pr === "none"
      ? []
      : [{ id: "repo-1", repoOwner: "acme", repoName: "storefront" }],
}))
// The PR create server action, held open per test to see it running.
const createPrAction = vi.hoisted(() => vi.fn())
vi.mock("@/lib/create-pr-action", () => ({
  createPullRequestAction: createPrAction,
}))
// Whether any member's agent is working on the Workspace (Workspace State).
const workspace_ = vi.hoisted(() => ({ agentWorking: false }))
vi.mock("@/hooks/use-workspace-states", () => ({
  useWorkspaceStates: () => () => ({ agentWorking: workspace_.agentWorking }),
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
import type { DevServerControls } from "./terminal-pane"

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
  preview.failing = false
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

  it("collapses from the header's one Hide chat button", () => {
    const { onCollapse } = renderRoomPanel()
    const buttons = screen.getAllByRole("button", { name: /Hide chat/ })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onCollapse).toHaveBeenCalledOnce()
  })
})

const workspace = {
  id: "ws-1",
  repoId: "repo-1",
  title: "Checkout polish",
  ref: "checkout-polish",
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
    agent?: Partial<BranchData>
    devServerControls?: DevServerControls
    diffStats?: { additions: number; deletions: number }
    branchPr?: BranchPrInfo | null
  } = {}
) {
  const onSelectChat = vi.fn()
  const onCloseTerminal = vi.fn()
  const props = {
    target: {
      kind: "agent" as const,
      agent: { ...workspace, ...options.agent } as BranchData,
    },
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
    onPlanModeChange: noop,
    onModelChange: noop,
    onCollapse: noop,
    logsRequest: options.logsRequest ?? null,
    devServerControls: options.devServerControls,
    diffStats: options.diffStats,
    branchPr: options.branchPr,
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
  it("shows the +/− counts until a pull request is open", () => {
    const diffStats = { additions: 214, deletions: 37 }
    const pr = (state: BranchPrInfo["state"]) => ({
      number: 482,
      url: "https://github.com/acme/storefront/pull/482",
      state,
    })
    const { unmount } = renderWorkspacePanel({ diffStats })
    expect(screen.getByText("+214")).toBeTruthy()
    unmount()
    const open = renderWorkspacePanel({ diffStats, branchPr: pr("open") })
    expect(screen.queryByText("+214")).toBeNull()
    expect(screen.getByText(/#482/)).toBeTruthy()
    open.unmount()
    renderWorkspacePanel({ diffStats, branchPr: pr("merged") })
    expect(screen.getByText("+214")).toBeTruthy()
  })

  it("offers Create PR only with changes, and only with GitHub", () => {
    const createPr = () => screen.queryByRole("button", { name: /Create PR/ })
    const { unmount } = renderWorkspacePanel()
    expect(createPr()?.hasAttribute("disabled")).toBe(true)
    unmount()
    const changed = renderWorkspacePanel({
      diffStats: { additions: 3, deletions: 1 },
    })
    expect(createPr()?.hasAttribute("disabled")).toBe(false)
    changed.unmount()
    github.pr = "none"
    try {
      renderWorkspacePanel({ diffStats: { additions: 3, deletions: 1 } })
      expect(createPr()).toBeNull()
    } finally {
      github.pr = "ready"
    }
  })

  it("shows Create PR disabled until GitHub is connected (H3)", async () => {
    github.pr = "connect"
    try {
      renderWorkspacePanel({ diffStats: { additions: 3, deletions: 1 } })
      const button = screen.getByRole("button", { name: /Create PR/ })
      expect(button.hasAttribute("disabled")).toBe(true)
      await act(async () => {
        fireEvent.focus(button.parentElement!)
      })
      expect((await screen.findByRole("tooltip")).textContent).toBe(
        "Connect GitHub in Settings to open pull requests."
      )
    } finally {
      github.pr = "ready"
    }
  })

  it("disables Create PR while another member's agent works, saying why", async () => {
    workspace_.agentWorking = true
    try {
      renderWorkspacePanel({ diffStats: { additions: 3, deletions: 1 } })
      const button = screen.getByRole("button", { name: /Create PR/ })
      expect(button.hasAttribute("disabled")).toBe(true)
      await act(async () => {
        fireEvent.focus(button.parentElement!)
      })
      expect((await screen.findByRole("tooltip")).textContent).toBe(
        "The agent is still working."
      )
    } finally {
      workspace_.agentWorking = false
    }
  })

  it("links a merged PR and offers no new one", () => {
    renderWorkspacePanel({
      diffStats: { additions: 3, deletions: 1 },
      branchPr: { number: 482, url: "https://x", state: "merged" },
    })
    expect(screen.getByText(/#482/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Create PR/ })).toBeNull()
  })

  it("offers no Create PR on a Done Workspace", () => {
    renderWorkspacePanel({
      diffStats: { additions: 3, deletions: 1 },
      agent: { doneAt: 1 },
    })
    expect(screen.queryByRole("button", { name: /Create PR/ })).toBeNull()
  })

  it("shows Create PR running, and won't start a second", async () => {
    let settle!: (r: unknown) => void
    createPrAction.mockReturnValue(new Promise((r) => (settle = r)))
    renderWorkspacePanel({ diffStats: { additions: 3, deletions: 1 } })
    fireEvent.click(screen.getByRole("button", { name: /Create PR/ }))
    const running = screen.getByRole("button", {
      name: /Create PR/,
    })
    expect(running.hasAttribute("disabled")).toBe(true)
    expect(within(running).getByRole("status")).toBeTruthy()
    fireEvent.click(running)
    expect(createPrAction).toHaveBeenCalledTimes(1)
    await act(async () => settle({ success: false, error: "nope" }))
    expect(screen.getByRole("button", { name: /Create PR/ })).toBeTruthy()
  })

  it("shows the chat with no tab strip, and a footnote naming its terminals", () => {
    renderWorkspacePanel()
    expect(screen.getByTestId("agent-chat").dataset.chatId).toBe("chat-1")
    expect(screen.queryByRole("tab", { name: /Sandbox logs/ })).toBeNull()
    expect(paneState()).toBe("closed")
    const names = within(screen.getByRole("tablist", { name: "Terminals" }))
      .getAllByRole("tab")
      .map((b) => b.textContent)
    expect(names).toEqual(["Preview", "Shell", "Shell 2"])
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
      screen.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")
    ).toBe("true")
    act(() => {
      fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true })
    })
    expect(paneState()).toBe("closed")
  })

  it("remembers that the pane is open, across Workspaces and reloads", () => {
    const first = renderWorkspacePanel()
    fireEvent.click(terminalName("Preview"))
    first.unmount()
    renderWorkspacePanel({ terminalTabs: [] })
    expect(paneState()).toBe("open")
    expect(screen.getByRole("tab", { name: "Preview" })).toBeTruthy()
  })

  it("never offers to close Dev server", () => {
    renderWorkspacePanel()
    fireEvent.click(terminalName("Preview"))
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

  it("+ opens a plain shell and selects it, with no harness to pick", () => {
    const onCreateTerminal = vi.fn(() => "s3")
    const { rerender, props } = renderWorkspacePanel()
    rerender(<ChatPanel {...props} onCreateTerminal={onCreateTerminal} />)
    fireEvent.click(terminalName("Preview"))
    expect(
      screen.queryByRole("button", { name: /New terminal with/ })
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }))
    expect(onCreateTerminal).toHaveBeenCalledWith()
    rerender(
      <ChatPanel
        {...props}
        onCreateTerminal={onCreateTerminal}
        terminalTabs={[...props.terminalTabs, shell("s3", "Terminal", 3)]}
      />
    )
    expect(
      screen
        .getByRole("tab", { name: "Terminal" })
        .getAttribute("aria-selected")
    ).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: /Hide terminal/ }))
    expect(paneState()).toBe("closed")
    expect(
      within(screen.getByRole("tablist", { name: "Terminals" }))
        .getAllByRole("tab")
        .map((b) => b.textContent)
    ).toEqual(["Preview", "Shell", "Shell 2", "Terminal"])
  })

  it("opens the pane on Dev server for a frame's Open logs", () => {
    const { rerender, props } = renderWorkspacePanel()
    expect(paneState()).toBe("closed")
    rerender(
      <ChatPanel {...props} logsRequest={{ agentId: "ws-1", nonce: 1 }} />
    )
    expect(paneState()).toBe("open")
    expect(
      screen.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")
    ).toBe("true")
  })

  it("shows a selected earlier chat read-only", () => {
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
    rerender(<ChatPanel {...props} selectedChatId="old" />)
    const shown = screen
      .getAllByTestId("agent-chat")
      .filter((el) => !el.parentElement?.classList.contains("hidden"))
    expect(shown.map((el) => el.dataset.chatId)).toEqual(["old"])
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }))
    expect(onSelectChat).toHaveBeenCalledWith("chat-1")
  })

  it("has no Chat history button, even with earlier chats", () => {
    renderWorkspacePanel({
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
    expect(screen.queryByRole("button", { name: "Chat history" })).toBeNull()
  })
})

describe("the dev server's Run and Stop (#1342)", () => {
  function controls() {
    return {
      stop: vi.fn(async () => {}),
      run: vi.fn(async () => {}),
    } satisfies DevServerControls
  }
  const stateOf = (el: HTMLElement) =>
    el
      .querySelector("[data-dev-server-state]")
      ?.getAttribute("data-dev-server-state")
  const dot = () => stateOf(terminalName("Preview"))
  const openPane = () => fireEvent.click(terminalName("Preview"))

  it("stops a running dev server from the closed footnote, without opening the pane", async () => {
    const devServerControls = controls()
    renderWorkspacePanel({ devServerControls })
    expect(dot()).toBe("running")
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    })
    expect(devServerControls.stop).toHaveBeenCalledWith("ws-1")
    expect(paneState()).toBe("closed")
  })

  it("offers Run for a stopped dev server, with a quiet dot", async () => {
    const devServerControls = controls()
    renderWorkspacePanel({
      devServerControls,
      agent: { devServerStoppedAt: 1 },
    })
    expect(dot()).toBe("stopped")
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }))
    })
    expect(devServerControls.run).toHaveBeenCalledWith("ws-1")
  })

  it("puts Stop in the open bar while it runs, and no Restart", () => {
    renderWorkspacePanel({ devServerControls: controls() })
    openPane()
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Restart/ })).toBeNull()
  })

  it("puts Run in the open bar while it's stopped", () => {
    renderWorkspacePanel({
      devServerControls: controls(),
      agent: { devServerStoppedAt: 1 },
    })
    openPane()
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
  })

  it("shows a crash on the dots and offers Run to bring it back", async () => {
    preview.failing = true
    const devServerControls = controls()
    renderWorkspacePanel({ devServerControls })
    expect(dot()).toBe("crashed")
    openPane()
    expect(stateOf(screen.getByRole("tab", { name: "Preview" }))).toBe(
      "crashed"
    )
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }))
    })
    expect(devServerControls.run).toHaveBeenCalledWith("ws-1")
  })

  it("has no controls while the Sandbox itself isn't running", () => {
    renderWorkspacePanel({
      devServerControls: controls(),
      agent: { status: "stopped" },
    })
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull()
  })

  it("has no controls where none are given (the player)", () => {
    renderWorkspacePanel()
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
  })

  it("never stops the server on Ctrl-C in Dev server", () => {
    const devServerControls = controls()
    renderWorkspacePanel({ devServerControls })
    openPane()
    const output = screen.getByTestId("dev-server-output")
    fireEvent.keyDown(output, { key: "c", code: "KeyC", ctrlKey: true })
    fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true })
    expect(devServerControls.stop).not.toHaveBeenCalled()
  })
})
