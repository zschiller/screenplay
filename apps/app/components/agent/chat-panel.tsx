"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  ArrowUpRightIcon,
  ChatCircleIcon,
  GitDiffIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  PlusIcon,
} from "@workspace/ui/components/icons"
import { toast } from "sonner"
import { createPullRequestAction } from "@/lib/create-pr-action"
import { openExternal } from "@/lib/open-external"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { AgentChat } from "./agent-chat"
import { ChatPanelHeader } from "./chat-panel-header"
import { CoordinatorChat } from "./coordinator-chat"
import { ChatsMenuButton } from "./chats-menu"
import { TerminalPane, type DevServerControls } from "./terminal-pane"
import { useTerminalPaneController } from "./use-terminal-pane-controller"
import { WorkspaceHeaderTitle } from "./workspace-menu"
import type { ChatSessionData, TerminalTabData } from "@/lib/types"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import { DEV_SERVER_TERMINAL_ID } from "@/lib/chat/terminal-pane"
import { useAppSession } from "@/lib/auth-client"
import type { AgentMessage } from "@/lib/agent/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo, BranchPrState } from "@/lib/github-actions"
import { prStateButtonColor } from "@/components/pr-state-color"
import { chatStore } from "@/lib/chat-store"
import { ROOM_CHAT_LABEL, roomChatId } from "@/lib/chat/room-chat"
import { chatTargetOf, type ChatPanelTarget } from "@/lib/chat/chat-target"
import type { WorkspaceTaskRef } from "@/lib/agent/workspace-task"

/** A Workspace target: its chat over the Terminal Pane. */
type WorkspaceTarget = Extract<ChatPanelTarget, { kind: "agent" }>
/** A chat with no repository: its chat alone, no sandbox or terminals. */
type SketchTarget = Extract<ChatPanelTarget, { kind: "sketch" }>

const NO_TERMINALS: TerminalTabData[] = []

// Scan a chat's messages newest-first for the most recent completed
// `create_pr` tool call and pull the PR url/number out of its output. Pure over
// `messages` so the `useMemo` below is a single reactive call the compiler can
// preserve.
function findLatestPr(
  messages: AgentMessage[]
): { url: string; number: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m.role === "tool_call" &&
      m.title === "create_pr" &&
      m.status === "completed"
    ) {
      const output = m.content
        .map((b) =>
          b.type === "content" && b.content.type === "text"
            ? b.content.text
            : ""
        )
        .join("\n")
      const url = output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
      const num = output.match(/#(\d+)/)?.[1]
      if (url && num) return { url, number: num }
    }
  }
  return null
}

function useLatestPr(chatId: string): { url: string; number: string } | null {
  const messages = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId).messages,
    () => []
  )
  return useMemo(() => findLatestPr(messages), [messages])
}

function useAnyChatStreaming(chatIds: string[]): boolean {
  const key = chatIds.join(",")
  const subscribe = useCallback(
    (cb: () => void) => {
      const unsubs = chatIds.map((id) => chatStore.subscribe(id, cb))
      return () => unsubs.forEach((u) => u())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  const getSnapshot = useCallback(
    () => chatIds.some((id) => chatStore.getSnapshot(id).isStreaming),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

interface ChatPanelProps {
  target: ChatPanelTarget
  chatSessions: ChatSessionData[]
  /** This client's local terminal tabs for the current target. Held in their
   *  own collection (never `chatSessions`), so a terminal can't enter the
   *  conversation model. Empty/absent where there are no shells (the player). */
  terminalTabs?: TerminalTabData[]
  /** The chat on show: the Workspace's own chat, or one of its earlier chats
   *  when a remembered selection lands on one. */
  selectedChatId: string | null
  roomId: string
  onSelectChat: (chatId: string | null) => void
  /** Go back to the panel's home, the Coordinator chat (the header's first
   *  crumb). Absent where there is no Coordinator to go back to. */
  onShowRoomChat?: () => void
  /** Start the chat of a Workspace that has none (one made terminal-first
   *  before #1315). */
  onCreateChat: () => void
  /** Open a new plain shell against the Workspace's sandbox and return its
   *  id. Absent where shells can't be opened (the player). */
  onCreateTerminal?: () => string
  onRenameTerminal?: (id: string, label: string) => void
  /** Close a terminal: drop the tab and kill its session. */
  onCloseTerminal?: (id: string) => void
  onPlanModeChange: (chatId: string, planMode: boolean) => void
  onModelChange: (chatId: string, model: string) => void
  diffStats?: DiffStats
  /**
   * GitHub-polled PR state for this agent's branch. Used as a fallback when
   * the current chat's history doesn't contain a `create_pr` tool result —
   * e.g. PR was opened from an earlier chat, the gh CLI, or GitHub
   * directly. Without this the "Create PR" button can show even when a PR
   * is already open.
   */
  branchPr?: BranchPrInfo | null
  /**
   * Records a freshly-created PR into the shared source of truth so the sidebar
   * icon and branch menu update the instant this panel's "Create PR" button
   * succeeds, rather than on the next 60s poll.
   */
  onPrCreated?: (branchId: string, pr: BranchPrInfo) => void
  onCollapse: () => void
  /** Open a Workspace from a Coordinator task row (Room target only). */
  onOpenWorkspace?: (task: WorkspaceTaskRef) => void
  /**
   * Ask the panel to show a Workspace's dev server output (a frame's "Open
   * logs", issue #731): the Terminal Pane opens on Dev server. Honoured once
   * per `nonce`, as soon as `agentId` is the panel's target, so a request made
   * alongside a target switch lands after it.
   */
  logsRequest?: { agentId: string; nonce: number } | null
  /** Run and Stop for the Workspace's dev server (#1342). Absent
   *  where it can't be controlled (the player), which hides the buttons. */
  devServerControls?: DevServerControls
}

/**
 * The right chat panel for one target. A Workspace gets its one chat over the
 * Terminal Pane; the Room gets its one Coordinator chat (#893); a chat with no
 * repository gets just its chat. All sit under the same
 * {@link ChatPanelHeader}.
 */
export function ChatPanel(props: ChatPanelProps) {
  const { target } = props
  if (target.kind === "room") {
    const chatId = roomChatId(props.roomId)
    return (
      <div className="flex h-full flex-col bg-background">
        {/* `box-content` keeps the border outside the 48px row, so the title
            sits where the Workspace header's Coordinator crumb does and
            doesn't jump half a pixel when you switch between them. */}
        <ChatPanelHeader
          onCollapse={props.onCollapse}
          className="box-content border-b border-border"
        >
          <h2 className="text-sm font-medium">{ROOM_CHAT_LABEL}</h2>
          <div className="ml-auto flex items-center">
            <ChatsMenuButton />
          </div>
        </ChatPanelHeader>
        <CoordinatorChat
          roomId={props.roomId}
          chatSession={props.chatSessions.find((c) => c.id === chatId)}
          onModelChange={props.onModelChange}
          onOpenWorkspace={props.onOpenWorkspace ?? (() => {})}
        />
      </div>
    )
  }
  if (target.kind === "sketch") {
    return <SketchChatPanel {...props} target={target} />
  }
  return <WorkspaceChatPanel {...props} target={target} />
}

/** The Coordinator crumb that leads a Workspace or sketch chat's header. */
function CoordinatorCrumb({ onShowRoomChat }: { onShowRoomChat?: () => void }) {
  if (!onShowRoomChat) return null
  return (
    <>
      <button
        type="button"
        onClick={onShowRoomChat}
        className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {ROOM_CHAT_LABEL}
      </button>
      <span
        aria-hidden
        className="mx-1.5 shrink-0 text-sm text-muted-foreground"
      >
        /
      </span>
    </>
  )
}

function SketchChatPanel({
  target,
  roomId,
  onShowRoomChat,
  onModelChange,
  onCollapse,
}: ChatPanelProps & { target: SketchTarget }) {
  const chat = target.chat
  return (
    <div className="flex h-full flex-col bg-background">
      <ChatPanelHeader
        onCollapse={onCollapse}
        className="box-content border-b border-border"
      >
        <CoordinatorCrumb onShowRoomChat={onShowRoomChat} />
        <h2 className="min-w-0 truncate text-sm font-medium">{chat.label}</h2>
      </ChatPanelHeader>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AgentChat
          key={chat.id}
          chatId={chat.id}
          roomId={roomId}
          target={chatTargetOf(target)}
          model={chat.model}
          onModelChange={(m) => onModelChange(chat.id, m)}
          isActive
        />
      </div>
    </div>
  )
}

function WorkspaceChatPanel({
  target,
  chatSessions,
  terminalTabs = NO_TERMINALS,
  selectedChatId,
  roomId,
  onSelectChat,
  onShowRoomChat,
  onCreateChat,
  onCreateTerminal,
  onRenameTerminal,
  onCloseTerminal,
  onPlanModeChange,
  onModelChange,
  diffStats,
  branchPr,
  onPrCreated,
  onCollapse,
  logsRequest,
  devServerControls,
}: ChatPanelProps & { target: WorkspaceTarget }) {
  const agent = target.agent
  const chatTarget = chatTargetOf(target)
  // The Workspace's one chat (#1315). Any other chat here is an earlier chat
  // from before #1315. The panel has no way to open one; a remembered
  // selection that lands on one shows it read-only in place of the
  // Workspace's chat until you go back to it.
  const ownChatId = workspaceChatId(chatSessions, agent.id)
  const ownChat = chatSessions.find((c) => c.id === ownChatId)
  const shownEarlierChat =
    selectedChatId && selectedChatId !== ownChatId
      ? chatSessions.find((c) => c.id === selectedChatId)
      : undefined
  const shownChatId = shownEarlierChat?.id ?? ownChatId ?? ""

  // Select the Workspace's chat when nothing is, so the panel's selection
  // names what it shows.
  useEffect(() => {
    if (!selectedChatId && ownChatId) onSelectChat(ownChatId)
  }, [selectedChatId, ownChatId, onSelectChat])

  const { data: session } = useAppSession()
  const pane = useTerminalPaneController({
    userId: session?.user.id,
    branchId: agent.id,
    shells: terminalTabs,
  })

  // A frame's "Open logs": open the pane on Dev server, once per request.
  const handledLogsNonce = useRef(0)
  const openPaneOn = pane.openOn
  useEffect(() => {
    if (
      logsRequest &&
      logsRequest.nonce !== handledLogsNonce.current &&
      logsRequest.agentId === agent.id
    ) {
      handledLogsNonce.current = logsRequest.nonce
      openPaneOn(DEV_SERVER_TERMINAL_ID)
    }
  }, [logsRequest, agent.id, openPaneOn])

  const chatHistoryPr = useLatestPr(shownChatId)
  // The polled branch PR carries state and blocked; a `create_pr` result in this
  // chat's history only knows the number, so it's used when the poll hasn't
  // seen that PR yet.
  const displayPr: {
    url: string
    number: string
    state: BranchPrState
    blocked?: boolean
  } | null =
    branchPr &&
    (!chatHistoryPr || chatHistoryPr.number === String(branchPr.number))
      ? {
          url: branchPr.url,
          number: String(branchPr.number),
          state: branchPr.state,
          blocked: branchPr.blocked,
        }
      : chatHistoryPr
        ? { ...chatHistoryPr, state: "open" }
        : null
  // The PR button's icon and color mirror the sidebar branch icon so the two
  // stay legible together: open = green, merged = purple, closed = red. An open
  // PR that can't merge (failing checks, a conflict) turns red with the
  // merge-blocked icon.
  const prBlocked = displayPr?.state === "open" && !!displayPr.blocked
  const PrStateIcon = prBlocked
    ? GitDiffIcon
    : displayPr?.state === "merged"
      ? GitMergeIcon
      : GitPullRequestIcon
  const prColor = prStateButtonColor(
    prBlocked ? "closed" : (displayPr?.state ?? "open")
  )
  const isAgentBusy = agent.status === "creating" || agent.status === "starting"
  const allChatIds = useMemo(
    () => chatSessions.map((c) => c.id),
    [chatSessions]
  )
  const anyChatStreaming = useAnyChatStreaming(allChatIds)
  const [creatingPr, setCreatingPr] = useState(false)

  // Calls the direct PR-creation server action (#355) — same path as the Branch
  // menu's "Create pull request" item, no model turn. The created PR (or a
  // redacted error) surfaces in a toast.
  const handleCreatePr = async () => {
    if (!agent.sandboxName || creatingPr) return
    setCreatingPr(true)
    try {
      const result = await createPullRequestAction(roomId, agent.sandboxName)
      if (result.success) {
        const { url, number } = result.value
        onPrCreated?.(agent.id, { number, url, state: "open" })
        toast.success("Pull request created", {
          description: `#${number}`,
          action: {
            label: "View on GitHub",
            onClick: () => openExternal(url),
          },
        })
      } else {
        toast.error("Couldn't create pull request", {
          description: result.error,
        })
      }
    } finally {
      setCreatingPr(false)
    }
  }

  // First chat for this Workspace — drives auto branch/chat naming.
  const isFirstChat = (chat: ChatSessionData) =>
    !chatSessions.some((c) => c.id !== chat.id && c.branchId === chat.branchId)

  const renderChat = (chat: ChatSessionData, shown: boolean) => (
    <div
      key={chat.id}
      className={cn("min-h-0 flex-1 overflow-hidden", !shown && "hidden")}
    >
      <AgentChat
        chatId={chat.id}
        roomId={roomId}
        target={chatTarget}
        sandboxStatus={agent.status}
        isFirstChat={isFirstChat(chat)}
        planMode={chat.planMode}
        onPlanModeChange={(pm) => onPlanModeChange(chat.id, pm)}
        model={chat.model}
        onModelChange={(m) => onModelChange(chat.id, m)}
        isActive={shown}
        onOpenWorkspaceChat={
          ownChatId && chat.id !== ownChatId
            ? () => onSelectChat(ownChatId)
            : undefined
        }
      />
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-background">
      <ChatPanelHeader
        onCollapse={onCollapse}
        className="box-content border-b border-border"
      >
        <CoordinatorCrumb onShowRoomChat={onShowRoomChat} />
        {/* Where you are, not a switcher: the Coordinator crumb goes back to
            the top level, where the Chats button lives (#1152). The title's
            … holds the Workspace's menu (H4). */}
        <WorkspaceHeaderTitle branch={agent} />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {/* An open PR already carries the diff, so its counts go. */}
          {diffStats &&
            displayPr?.state !== "open" &&
            (diffStats.additions > 0 || diffStats.deletions > 0) && (
              <span className="flex items-center gap-1 font-mono text-xs">
                <span className="text-success">+{diffStats.additions}</span>
                <span className="text-destructive">-{diffStats.deletions}</span>
              </span>
            )}
          {displayPr ? (
            <Button size="xs" variant="outline" asChild>
              <a
                href={displayPr.url}
                target="_blank"
                rel="noopener noreferrer"
                title={prBlocked ? "Merge blocked" : undefined}
                className={cn("group", prColor)}
              >
                <PrStateIcon />#{displayPr.number}
                <ArrowUpRightIcon className="opacity-60 group-hover:opacity-100" />
              </a>
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={handleCreatePr}
              disabled={
                !agent.sandboxName ||
                isAgentBusy ||
                anyChatStreaming ||
                creatingPr
              }
              title={
                isAgentBusy
                  ? "The workspace is still starting…"
                  : anyChatStreaming
                    ? "The agent is still working."
                    : undefined
              }
            >
              <GitPullRequestIcon />
              Create pull request
            </Button>
          )}
        </div>
      </ChatPanelHeader>

      <TerminalPane
        pane={pane}
        agent={agent}
        roomId={roomId}
        onCreateShell={onCreateTerminal}
        onRenameShell={onRenameTerminal}
        onCloseShell={onCloseTerminal}
        devServer={devServerControls}
      >
        {ownChat ? (
          renderChat(ownChat, !shownEarlierChat)
        ) : !shownEarlierChat ? (
          // A Workspace made terminal-first before #1315 has no chat yet:
          // something to press instead of a blank panel.
          <Empty className="rounded-none bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChatCircleIcon />
              </EmptyMedia>
              <EmptyTitle>No chat yet</EmptyTitle>
              <EmptyDescription>
                Start this workspace&apos;s chat.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isAgentBusy}
                onClick={onCreateChat}
              >
                <PlusIcon />
                New chat
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {shownEarlierChat && renderChat(shownEarlierChat, true)}
      </TerminalPane>
    </div>
  )
}
