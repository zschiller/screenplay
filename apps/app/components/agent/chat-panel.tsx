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
  CaretDownIcon,
  ChatCircleIcon,
  GitDiffIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  ListDashesIcon,
  PlusIcon,
  TerminalWindowIcon,
  XIcon,
} from "@workspace/ui/components/icons"
import { AnimatePresence, motion, Reorder } from "motion/react"
import { toast } from "sonner"
import { createPullRequestAction } from "@/lib/create-pr-action"
import { openExternal } from "@/lib/open-external"
import { GripSpinner } from "@/components/grip-spinner"
import {
  EditableText,
  editableTextFieldClass,
} from "@workspace/ui/components/editable-text"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { IconButton } from "@workspace/ui/components/icon-button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { AgentChat } from "./agent-chat"
import { LogsPanel } from "./logs-panel"
import { TerminalTab } from "./terminal-tab"
import { useTerminalCloseGuard } from "./use-terminal-close-guard"
import { ChatHistoryMenu } from "./chat-history-menu"
import { ChatPanelHeader } from "./chat-panel-header"
import { CoordinatorChat } from "./coordinator-chat"
import { ChatsMenuButton } from "./chats-menu"
import { WorkspaceMention } from "@/components/workspace-mention"
import { WorkspaceHoverCard } from "@/components/workspace-hover-card"
import type { ChatSessionData, TerminalTabData } from "@/lib/types"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import {
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  readTabOrder,
  writeLastHarnessKey,
  writeLastTabKind,
  writeTabOrder,
} from "@/lib/canvas/tab-kind"
import { useAppSession } from "@/lib/auth-client"
import { useInstalledHarnesses } from "@/hooks/use-installed-harnesses"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import type { AgentMessage } from "@/lib/agent/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo, BranchPrState } from "@/lib/github-actions"
import { prStateColor } from "@/components/pr-state-color"
import { chatStore } from "@/lib/chat-store"
import { ROOM_CHAT_LABEL, roomChatId } from "@/lib/chat/room-chat"
import { chatTargetOf, type ChatPanelTarget } from "@/lib/chat/chat-target"
import type { WorkspaceTaskRef } from "@/lib/agent/workspace-task"

/** A target that has a tab strip: a Workspace's chats. */
type TabbedTarget = Exclude<ChatPanelTarget, { kind: "room" }>

const LOGS_TAB_VALUE = "__sandbox_logs__"

// Horizontal scrolling for the tab strip is driven imperatively (sticky
// right-edge, reveal-on-add) against the Radix ScrollArea's viewport. We reach
// it through this stable data-attribute rather than threading a ref through the
// shared ScrollArea wrapper (which forwards to its Root, not the viewport).
const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'

// Within how many px of the right edge counts as "pinned right". A couple of
// px of slack absorbs sub-pixel rounding from fractional widths/zoom.
const RIGHT_EDGE_SLACK_PX = 2

// Width of the fade at a strip edge that has tabs scrolled past it, and the
// inset a revealed tab keeps from the edge (the same, so it clears the fade).
// The left fade is wider so a tab cut there fades out over a whole glyph or
// two instead of showing a sliver of one beside the pinned logs tab.
const EDGE_FADE_PX = 16
const LEFT_EDGE_FADE_PX = 28

// Scroll `viewport` the minimum amount so `el` is fully visible, with a little
// padding so a revealed tab isn't flush against the edge. A tab already in view
// but flush (the browser scrolls a clicked tab just into view on focus) gets
// the padding too.
function ensureTabVisible(viewport: HTMLElement, el: HTMLElement) {
  const vpRect = viewport.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  if (elRect.left < vpRect.left + LEFT_EDGE_FADE_PX) {
    // Back at the start when the tab fits there, so the strip rests where it
    // began rather than just short of it.
    const rightAtStart = elRect.right - vpRect.left + viewport.scrollLeft
    if (rightAtStart + EDGE_FADE_PX <= viewport.clientWidth) {
      viewport.scrollLeft = 0
    } else {
      viewport.scrollLeft -= vpRect.left - elRect.left + LEFT_EDGE_FADE_PX
    }
  } else if (elRect.right > vpRect.right - EDGE_FADE_PX) {
    viewport.scrollLeft += elRect.right - vpRect.right + EDGE_FADE_PX
  }
}

// Fade out whichever edges of the strip have tabs scrolled past them, so a
// clipped tab reads as "more this way" rather than cut off. Set imperatively,
// like the scrolling, since it follows every scroll event.
function updateEdgeFade(viewport: HTMLElement) {
  const overflow = viewport.scrollWidth - viewport.clientWidth
  const left = viewport.scrollLeft > RIGHT_EDGE_SLACK_PX
  const right = overflow - viewport.scrollLeft > RIGHT_EDGE_SLACK_PX
  viewport.style.maskImage =
    left || right
      ? `linear-gradient(to right, transparent, #000 ${left ? LEFT_EDGE_FADE_PX : 0}px, #000 calc(100% - ${right ? EDGE_FADE_PX : 0}px), transparent)`
      : ""
}

// Whether the operator is parked at the strip's right edge. Only when the strip
// actually overflows: a strip that fits (or isn't laid out yet on mount) would
// otherwise read as pinned and get jumped to the end on the next resize.
function isPinnedRight(viewport: HTMLElement) {
  const overflow = viewport.scrollWidth - viewport.clientWidth
  return (
    overflow > RIGHT_EDGE_SLACK_PX &&
    overflow - viewport.scrollLeft <= RIGHT_EDGE_SLACK_PX
  )
}

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

function useChatStatus(chatId: string) {
  const isStreaming = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId).isStreaming,
    () => false
  )
  const hasUnread = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.hasUnread(chatId),
    () => false
  )
  return { isStreaming, hasUnread }
}

// Width of the OS's native scrollbar, in px. 0 means overlay scrollbars (the
// macOS trackpad default); > 0 means classic space-taking scrollbars, which
// macOS switches to when a mouse is connected, and which Windows/Linux use
// always. So a positive width is a proactive "a mouse is (probably) present"
// signal available at load — no scroll required.
function measureScrollbarWidth(): number {
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll"
  document.body.appendChild(probe)
  const width = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return width
}

// A physical mouse wheel scrolls in discrete notches; a trackpad scrolls
// smoothly. There's no direct API for the device (a trackpad is also
// `pointer: fine`), so as a secondary signal we sniff the wheel event: Firefox
// reports line/page deltas for a real wheel (`deltaMode !== 0`), while
// Chromium/WebKit expose a legacy `wheelDeltaY` that's a multiple of 120 per
// notch.
//
// The 120 heuristic isn't airtight, though: in Chromium `wheelDeltaY ≈ -1.2 ·
// deltaY`, so a clean 120-multiple just means `deltaY` is a multiple of 100 —
// which a *fast* trackpad pan hits routinely (deltaY 100, 200, …), and a
// pinch-zoom (synthesized as ctrl-wheel) can hit too. A real wheel lands on a
// clean multiple on *every* notch; a trackpad only does so by coincidence and
// can't sustain it. So we ignore modifier-held (zoom) wheels and require a run
// of consecutive notch-looking events before trusting the signal.
const MOUSE_NOTCH_RUN = 3

// One pixel-mode wheel event: true if it looks like a discrete mouse notch.
// Line/page mode (Firefox real wheel) is handled by the caller as an immediate,
// unambiguous latch.
function wheelNotchLooksLikeMouse(e: WheelEvent): boolean {
  const wheelDeltaY = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
  return (
    typeof wheelDeltaY === "number" &&
    wheelDeltaY !== 0 &&
    Math.abs(wheelDeltaY) % 120 === 0
  )
}

// Whether to treat the user as a mouse user — drives showing the tab strip's
// scrollbar (trackpad users two-finger scroll and don't need it; matches the
// macOS "based on mouse or trackpad" scrollbar default). Primary signal is the
// native scrollbar width, re-checked on window focus so connecting/removing a
// mouse mid-session is picked up (macOS swaps scrollbar style live). A detected
// mouse wheel latches it on too, covering the macOS "show scrollbars only when
// scrolling" config where the gutter stays overlay (width 0) even with a mouse.
function useUsingMouse(): boolean {
  const [usingMouse, setUsingMouse] = useState(false)
  useEffect(() => {
    let sawWheel = false
    let notchRun = 0
    const latch = () => {
      sawWheel = true
      setUsingMouse(true)
    }
    const sync = () => setUsingMouse(sawWheel || measureScrollbarWidth() > 0)
    sync()
    const onWheel = (e: WheelEvent) => {
      if (sawWheel) return
      // Pinch-zoom (trackpad) and modifier-wheel zoom synthesize wheel events
      // that aren't clean notch signals — never infer a mouse from them.
      if (e.ctrlKey || e.metaKey) return
      // Firefox reports line/page deltas only for a real wheel — unambiguous,
      // latch on the first one.
      if (e.deltaMode !== 0) {
        latch()
        return
      }
      // Pixel mode: a single 120-multiple can be a fast-pan coincidence, so
      // require a sustained run; any non-notch event resets it.
      if (!wheelNotchLooksLikeMouse(e)) {
        notchRun = 0
        return
      }
      notchRun += 1
      if (notchRun >= MOUSE_NOTCH_RUN) latch()
    }
    window.addEventListener("focus", sync)
    window.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      window.removeEventListener("focus", sync)
      window.removeEventListener("wheel", onWheel)
    }
  }, [])
  return usingMouse
}

// A tab's inline-rename field. ALL geometry — the padding and the negative
// margins that cancel it — is reserved in BOTH modes (transparent in view) so
// the box is identical whether or not we're editing. Entering edit mode then
// only toggles paint (bg/shadow/ring), never layout, so the tab can't shift or
// resize. The negative margins cancel the padding so the popped box doesn't
// widen the tab's footprint.
const TAB_LABEL_CLASS =
  "max-w-[180px] min-w-0 rounded-xs px-0.5 py-0.5 -mx-0.5 -my-0.5"
// Edit-mode-only decoration. Uses theme tokens (not the sidebar rows' hardcoded
// white) so it reads against the tab strip.
const TAB_LABEL_EDIT_CLASS = editableTextFieldClass

function ChatTabLabel({
  chat,
  onRename,
}: {
  chat: ChatSessionData
  onRename: (label: string) => void
}) {
  const { isStreaming, hasUnread } = useChatStatus(chat.id)
  return (
    <span className="flex items-center gap-1.5">
      {isStreaming ? (
        <GripSpinner className="size-3.5 shrink-0 text-muted-foreground" />
      ) : hasUnread ? (
        <span className="size-1.5 shrink-0 rounded-full bg-info-fill" />
      ) : null}
      <EditableText
        as="span"
        value={chat.label}
        onCommit={onRename}
        placeholder="Untitled"
        className={TAB_LABEL_CLASS}
        viewClassName="truncate"
        editClassName={TAB_LABEL_EDIT_CLASS}
      />
    </span>
  )
}

/**
 * Tab label for a terminal tab. Same sans label as chat tabs (a terminal
 * running a harness is a chat); the terminal glyph is what sets it apart.
 * Reads no chat-store status: a terminal tab has no streaming/unread
 * conversation state.
 */
function TerminalTabLabel({
  terminal,
  onRename,
}: {
  terminal: TerminalTabData
  onRename: (label: string) => void
}) {
  return (
    <span className="flex items-center gap-1.5">
      <TerminalWindowIcon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <EditableText
        as="span"
        value={terminal.label}
        onCommit={onRename}
        placeholder="Untitled"
        className={TAB_LABEL_CLASS}
        viewClassName="truncate"
        editClassName={TAB_LABEL_EDIT_CLASS}
      />
    </span>
  )
}

/**
 * One entry in the panel's tab strip. A tagged union over the two distinct tab
 * types so the strip can render both in a single createdAt-ordered row while
 * the underlying chat/terminal collections stay separate. `id`, `label`, and
 * `createdAt` are lifted out so ordering and the shared tab chrome (rename,
 * close) don't have to branch on `kind`.
 */
type OpenTab =
  | {
      kind: "chat"
      id: string
      label: string
      createdAt: number
      chat: ChatSessionData
    }
  | {
      kind: "terminal"
      id: string
      label: string
      createdAt: number
      terminal: TerminalTabData
    }

interface ChatPanelProps {
  target: ChatPanelTarget
  chatSessions: ChatSessionData[]
  /** This client's local terminal tabs for the current target. Held in their
   *  own collection (never `chatSessions`), so a terminal can't enter the
   *  conversation model. Empty/absent for non-agent (layer) targets. */
  terminalTabs?: TerminalTabData[]
  selectedChatId: string | null
  roomId: string
  onSelectChat: (chatId: string | null) => void
  /** Go back to the panel's home, the Coordinator chat (the header's first
   *  crumb). Absent where there is no Coordinator to go back to. */
  onShowRoomChat?: () => void
  onCreateChat: () => void
  /** Open a new terminal tab against the current agent's sandbox, launching the
   *  given harness (by `Harness.key`). Absent for non-agent (layer) targets,
   *  which have no sandbox to attach a terminal to. */
  onCreateTerminal?: (harnessKey: string) => void
  onRenameChat: (chatId: string, label: string) => void
  onRemoveChat: (chatId: string) => void
  /** Close a tab. `nextSelectedId` is the visual neighbour to fall back to when
   *  the closed tab was selected — the tab after it in the displayed order, or
   *  the one before it when closing the last tab. Undefined when no other tab
   *  survives (the parent then recreates a default tab). */
  onCloseChat: (chatId: string, nextSelectedId?: string) => void
  onReopenChat: (chatId: string) => void
  onPlanModeChange: (chatId: string, planMode: boolean) => void
  onModelChange: (chatId: string, model: string) => void
  diffStats?: DiffStats
  /**
   * GitHub-polled PR state for this agent's branch. Used as a fallback when
   * the current chat's history doesn't contain a `create_pr` tool result —
   * e.g. PR was opened from a different chat tab, the gh CLI, or GitHub
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
  onLogsReady?: () => void
  /**
   * Ask the panel to show a Workspace's sandbox logs (a frame's "Open logs",
   * issue #731). Honoured once per `nonce`, as soon as `agentId` is the panel's
   * target, so a request made alongside a target switch lands after it.
   */
  logsRequest?: { agentId: string; nonce: number } | null
}

/**
 * The right chat panel for one target. A Workspace gets its tab strip of
 * chats, terminals and logs; the Room gets its one Coordinator chat (#893). Both sit under the same {@link ChatPanelHeader}.
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
  return <TabbedChatPanel {...props} target={target} />
}

function TabbedChatPanel({
  target,
  chatSessions,
  terminalTabs,
  selectedChatId,
  roomId,
  onSelectChat,
  onShowRoomChat,
  onCreateChat,
  onCreateTerminal,
  onRenameChat,
  onRemoveChat,
  onCloseChat,
  onReopenChat,
  onPlanModeChange,
  onModelChange,
  diffStats,
  branchPr,
  onPrCreated,
  onCollapse,
  onLogsReady,
  logsRequest,
}: ChatPanelProps & { target: TabbedTarget }) {
  const isAgentTarget = target.kind === "agent"
  const agent = target.kind === "agent" ? target.agent : null
  const chatTarget = chatTargetOf(target)
  // The Workspace's one chat (#1315): always open, never closed. Any other
  // chat here is an earlier chat from before #1315, kept readable.
  const ownChatId = agent ? workspaceChatId(chatSessions, agent.id) : undefined

  // The tab strip interleaves two distinct tab types — durable chats and
  // ephemeral terminals — in one createdAt-ordered row. We model each as a
  // tagged item rather than a shared base type so the conversation model can
  // never structurally hold a terminal.
  const openTabs = useMemo<OpenTab[]>(() => {
    const items: OpenTab[] = [
      ...chatSessions
        .filter((c) => !c.closedAt || c.id === ownChatId)
        .map((c) => ({
          kind: "chat" as const,
          id: c.id,
          label: c.label,
          createdAt: c.createdAt,
          chat: c,
        })),
      ...(terminalTabs ?? []).map((t) => ({
        kind: "terminal" as const,
        id: t.id,
        label: t.label,
        createdAt: t.createdAt,
        terminal: t,
      })),
    ]
    return items.sort((a, b) => a.createdAt - b.createdAt)
  }, [chatSessions, terminalTabs, ownChatId])

  const closedChats = useMemo(
    () =>
      [...chatSessions]
        .filter((c) => c.closedAt && c.id !== ownChatId)
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [chatSessions, ownChatId]
  )

  // Auto-select the first open tab (chat or terminal) if none selected
  useEffect(() => {
    if (!selectedChatId && openTabs.length > 0) {
      onSelectChat(openTabs[0].id)
    }
  }, [selectedChatId, openTabs, onSelectChat])

  const activeTab = selectedChatId ?? openTabs[0]?.id ?? ""
  const chatHistoryPr = useLatestPr(activeTab)
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
  const prColor = prStateColor(
    prBlocked ? "closed" : (displayPr?.state ?? "open")
  )
  const isAgentBusy = agent
    ? agent.status === "creating" || agent.status === "starting"
    : false
  const allChatIds = useMemo(
    () => chatSessions.map((c) => c.id),
    [chatSessions]
  )
  const anyChatStreaming = useAnyChatStreaming(allChatIds)
  const [showLogs, setShowLogs] = useState(false)
  const [creatingPr, setCreatingPr] = useState(false)
  const tabsValue = showLogs ? LOGS_TAB_VALUE : activeTab

  // The harnesses installed in this deployment's sandboxes — the menu the caret
  // draws (#290). Only fetched when terminals are creatable here (agent target).
  const { data: session } = useAppSession()
  const userId = session?.user.id
  const installedHarnesses = useInstalledHarnesses(!!onCreateTerminal)

  // The harness the sticky "+" launches when its kind is "terminal": the
  // operator's last pick if it's still installed, else the first installed
  // harness, else the catalog default (list not loaded yet / none installed).
  // Read per-User from localStorage during render — a hint only, never
  // authoritative (a tab's harness lives on its `terminal_tab.harnessKey` row),
  // so a stale value can't change an existing tab. A harness pick flips
  // the per-User pref, which is re-read on the next render.
  const storedHarnessKey = userId ? readLastHarnessKey(userId) : null
  const defaultHarnessKey =
    storedHarnessKey &&
    installedHarnesses.some((h) => h.key === storedHarnessKey)
      ? storedHarnessKey
      : (installedHarnesses[0]?.key ?? DEFAULT_HARNESS_KEY)

  // A Workspace has one chat (#1315), so "New chat" is only there for a
  // Workspace that has none yet (one made terminal-first before #1315).
  const createChatTab = useCallback(() => {
    writeLastTabKind("chat")
    onCreateChat()
  }, [onCreateChat])

  // Launch a terminal with `harnessKey` and make it the default: the "+"
  // button now repeats *this* harness, and (keyed per User) it survives reload.
  const createTerminalTab = useCallback(
    (harnessKey: string) => {
      writeLastTabKind("terminal")
      if (userId) writeLastHarnessKey(userId, harnessKey)
      onCreateTerminal?.(harnessKey)
    },
    [onCreateTerminal, userId]
  )

  // Reset the logs-visible flag whenever the chat target changes so a
  // freshly-selected target (whose LogsPanel is still fetching, if any)
  // doesn't inherit the previous target's "logs tab open" state. Done during
  // render via the previous-value pattern rather than in an effect, which
  // would cascade an extra render after the target switch.
  const targetKey = agent?.id ?? ""
  const [lastTargetKey, setLastTargetKey] = useState(targetKey)
  // Operator's drag-chosen tab order for this target (ids), seeded from
  // localStorage. Reconciled with the live tab set in `orderedTabs` below.
  const [tabOrder, setTabOrder] = useState<string[]>(() =>
    readTabOrder(targetKey)
  )
  // Tabs whose enter animation has finished (or that were already present when
  // this target's strip mounted). motion's Reorder REMOUNTS the dragged tab on
  // each swap; for a freshly-created tab that remount replays its width/opacity
  // enter for one frame — a visible flash/flicker, worst when moving rightward.
  // motion suppresses that replay for tabs present at an AnimatePresence's first
  // render, which is why older tabs reorder cleanly. So once a new tab finishes
  // entering we bump `reRegisterKey` to remount the AnimatePresence (still
  // `initial={false}`), re-registering every current tab — the new one included
  // — as "initial-present". From then on it reorders as cleanly as an older tab.
  const [enteredIds, setEnteredIds] = useState<Set<string>>(
    () => new Set(openTabs.map((t) => t.id))
  )
  const [reRegisterKey, setReRegisterKey] = useState(0)
  // A remount mid-drag would drop the gesture, so if a tab settles while the
  // operator is dragging, defer the re-register until the pointer is released.
  const draggingRef = useRef(false)
  const pendingReRegisterRef = useRef(false)
  if (targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey)
    setShowLogs(false)
    // Switching targets swaps in that target's own saved arrangement.
    setTabOrder(readTabOrder(targetKey))
    // The targetKey-keyed Reorder.Group remounts on switch, so this target's
    // tabs are already initial-present — seed them so they don't re-register.
    setEnteredIds(new Set(openTabs.map((t) => t.id)))
  }
  // A logs request, handled during render like the target reset above (and
  // after it, so the reset can't undo it).
  const [handledLogsNonce, setHandledLogsNonce] = useState(0)
  if (
    logsRequest &&
    logsRequest.nonce !== handledLogsNonce &&
    logsRequest.agentId === agent?.id
  ) {
    setHandledLogsNonce(logsRequest.nonce)
    setShowLogs(true)
  }

  // The displayed tab order: stored ids first (in saved order, skipping any
  // that have since closed), then any tabs not yet in the saved order appended
  // in their createdAt order. So a brand-new tab always lands at the end and a
  // never-reordered target falls back to pure createdAt order.
  const orderedTabs = useMemo<OpenTab[]>(() => {
    if (tabOrder.length === 0) return openTabs
    const byId = new Map(openTabs.map((t) => [t.id, t] as const))
    const result: OpenTab[] = []
    for (const id of tabOrder) {
      const tab = byId.get(id)
      if (tab) {
        result.push(tab)
        byId.delete(id)
      }
    }
    for (const tab of openTabs) if (byId.has(tab.id)) result.push(tab)
    return result
  }, [openTabs, tabOrder])

  const handleReorder = useCallback(
    (nextIds: string[]) => {
      setTabOrder(nextIds)
      writeTabOrder(targetKey, nextIds)
    },
    [targetKey]
  )

  // Called when a tab's enter animation completes. The first time we see a tab
  // that wasn't already registered, remount the AnimatePresence so motion treats
  // it as initial-present (see `enteredIds` above) — deferred if a drag is in
  // flight so the remount can't interrupt the gesture.
  const markTabEntered = useCallback(
    (id: string) => {
      if (enteredIds.has(id)) return
      setEnteredIds((prev) => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })
      if (draggingRef.current) {
        pendingReRegisterRef.current = true
        return
      }
      setReRegisterKey((k) => k + 1)
    },
    [enteredIds]
  )

  // Clear the drag flag (and flush any deferred re-register) on pointer release —
  // pointerup can land outside the strip after a drag, so listen on the window.
  useEffect(() => {
    const onPointerUp = () => {
      draggingRef.current = false
      if (pendingReRegisterRef.current) {
        pendingReRegisterRef.current = false
        setReRegisterKey((k) => k + 1)
      }
    }
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerUp)
    return () => {
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerUp)
    }
  }, [])

  // Show the tab strip's scrollbar only once we've seen a real mouse wheel;
  // trackpad users two-finger scroll and don't need it.
  const usingMouse = useUsingMouse()

  // The tab to select when `closingId` is closed: its neighbour in the *displayed*
  // order — the next tab, or the previous one when closing the last tab. Undefined
  // when it's the only tab. The parent prefers this over its own createdAt-ordered
  // fallback so closing a tab lands on the visually adjacent one, not the oldest.
  const neighbourTabId = useCallback(
    (closingId: string) => {
      const idx = orderedTabs.findIndex((t) => t.id === closingId)
      if (idx === -1) return undefined
      return (orderedTabs[idx + 1] ?? orderedTabs[idx - 1])?.id
    },
    [orderedTabs]
  )

  // A terminal's × asks first when the session is running something.
  const terminalClose = useTerminalCloseGuard({
    roomId,
    agent,
    onClose: onCloseChat,
  })

  // Imperative horizontal scrolling of the tab strip. `tabBarRef` wraps the
  // ScrollArea; we look up its viewport on demand rather than holding a ref the
  // shared wrapper doesn't expose. `pinnedRightRef` tracks whether the operator
  // is parked at the right edge (so we can keep them there as tabs are added).
  const tabBarRef = useRef<HTMLDivElement>(null)
  const pinnedRightRef = useRef(false)
  const prevTabCountRef = useRef(openTabs.length)
  const getViewport = useCallback(
    () =>
      tabBarRef.current?.querySelector<HTMLElement>(SCROLL_VIEWPORT_SELECTOR) ??
      null,
    []
  )

  // Bring the active chat/terminal tab fully into view (the logs tab is
  // pinned outside the scroller, so it's always in view). When the operator is parked at the right edge, or the active tab is
  // the last one, go to the right edge unless that would leave the active tab
  // cut off.
  const revealActiveTab = useCallback(() => {
    const vp = getViewport()
    if (!vp) return
    const trigger = vp.querySelector<HTMLElement>(
      '[role="tab"][data-state="active"]'
    )
    const tab = trigger?.closest<HTMLElement>("[data-tab-id]") ?? trigger
    // The last tab is revealed along with the "+" button after it.
    if (pinnedRightRef.current || (tab && !tab.nextElementSibling)) {
      vp.scrollLeft = vp.scrollWidth
    }
    if (tab) ensureTabVisible(vp, tab)
    pinnedRightRef.current = isPinnedRight(vp)
  }, [getViewport])

  // Keep `pinnedRightRef` and the edge fade current as the operator scrolls,
  // and keep the active tab in view whenever the strip or its content changes
  // size: the panel resizing, tabs being added by another client in the room,
  // or tabs settling after their enter animation.
  useEffect(() => {
    const vp = getViewport()
    if (!vp) return
    const updatePinned = () => {
      pinnedRightRef.current = isPinnedRight(vp)
      updateEdgeFade(vp)
    }
    updatePinned()
    vp.addEventListener("scroll", updatePinned, { passive: true })
    const ro = new ResizeObserver(() => {
      revealActiveTab()
      updateEdgeFade(vp)
    })
    ro.observe(vp)
    if (vp.firstElementChild) ro.observe(vp.firstElementChild)
    return () => {
      vp.removeEventListener("scroll", updatePinned)
      ro.disconnect()
    }
  }, [getViewport, revealActiveTab])

  // When a tab is created, reveal the right end: the new tab lands there, and
  // this also brings the "+" button back into view. Only once the new last tab
  // is the selected one (selection can follow a render after the tab appears):
  // tabs that arrive while the strip loads leave it on the active tab instead.
  const lastTabSelected = orderedTabs.at(-1)?.id === tabsValue
  const revealEndPendingRef = useRef(false)
  const prevTabsValueRef = useRef(tabsValue)
  useEffect(() => {
    const grew = openTabs.length > prevTabCountRef.current
    const picked = tabsValue !== prevTabsValueRef.current
    prevTabCountRef.current = openTabs.length
    prevTabsValueRef.current = tabsValue
    if (grew) revealEndPendingRef.current = true
    else if (picked && !lastTabSelected) revealEndPendingRef.current = false
    if (!revealEndPendingRef.current || !lastTabSelected) return
    revealEndPendingRef.current = false
    const vp = getViewport()
    if (!vp) return
    vp.scrollLeft = vp.scrollWidth
    pinnedRightRef.current = true
  }, [openTabs.length, tabsValue, lastTabSelected, getViewport])

  // Reveal the active tab on mount and whenever the selection or the set of
  // tabs changes (e.g. picking a tab that's scrolled off-screen, the
  // freshly-created tab becoming active, or the tabs arriving after mount).
  useEffect(() => {
    revealActiveTab()
  }, [tabsValue, openTabs.length, targetKey, revealActiveTab])

  // Fired by LogsPanel the first time it successfully connects to the stream.
  // We only auto-open logs at this point (not on agent.status === "starting")
  // so the panel doesn't flash before there's anything to show.
  const handleLogsConnected = useCallback(() => {
    if (agent && (agent.status === "creating" || agent.status === "starting")) {
      setShowLogs(true)
      onLogsReady?.()
    }
  }, [agent, onLogsReady])

  // Once setup finishes (status flips from creating/starting → running), switch
  // back from the auto-opened logs tab to the chat tab. Only relevant for
  // agent targets — doc targets have no setup phase.
  const prevStatusRef = useRef(agent?.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    if (
      agent &&
      (prev === "creating" || prev === "starting") &&
      agent.status === "running"
    ) {
      setShowLogs(false)
    }
    prevStatusRef.current = agent?.status
  }, [agent])

  // Calls the direct PR-creation server action (#355) — same path as the Branch
  // menu's "Create pull request" item, no model turn. The created PR (or a
  // redacted error) surfaces in a toast.
  const handleCreatePr = async () => {
    if (!agent?.sandboxName || creatingPr) return
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

  const handleTabChange = (value: string) => {
    if (value === LOGS_TAB_VALUE) {
      setShowLogs(true)
    } else {
      setShowLogs(false)
      onSelectChat(value)
    }
  }

  return (
    <Tabs
      value={tabsValue}
      onValueChange={handleTabChange}
      className="flex h-full flex-col gap-0"
    >
      <ChatPanelHeader onCollapse={onCollapse}>
        {onShowRoomChat && (
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
        )}
        {/* Where you are, not a switcher: the Coordinator crumb goes back to
            the top level, where the Workspaces button lives (#1152). */}
        <TargetPill target={target} />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {/* Diff stats and the PR button are agent-only — there's no
              git/branch concept for a doc target. */}
          {isAgentTarget &&
            diffStats &&
            (diffStats.additions > 0 || diffStats.deletions > 0) && (
              <span className="flex items-center gap-1 font-mono text-xs">
                <span className="text-success">+{diffStats.additions}</span>
                <span className="text-destructive">-{diffStats.deletions}</span>
              </span>
            )}
          {isAgentTarget &&
            (displayPr ? (
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
                  !agent?.sandboxName ||
                  isAgentBusy ||
                  anyChatStreaming ||
                  creatingPr
                }
                title={
                  isAgentBusy
                    ? "Sandbox still starting…"
                    : anyChatStreaming
                      ? "Agent is working in this workspace…"
                      : undefined
                }
              >
                <GitPullRequestIcon />
                Create PR
              </Button>
            ))}
        </div>
      </ChatPanelHeader>
      <div
        ref={tabBarRef}
        className="flex border-b border-border bg-background"
      >
        {/* One tab list across the whole strip, so arrow keys move from the
            logs tab into the chat tabs. Only the chat tabs and "+" scroll:
            the logs tab stays pinned at the left, as the closed-chats button
            is on the right. */}
        <TabsList
          variant="line"
          // Tall enough for the 28px close buttons to sit inside the tabs.
          // 11px puts the Logs icon (1px border + px-1.5 + half its 16px)
          // 26px in, under the collapse icon (header px-3 + half its 28px).
          className="min-w-0 flex-1 items-stretch gap-0 py-0 pr-0 pl-[11px] group-data-horizontal/tabs:h-10"
        >
          {isAgentTarget && (
            // Same 3px inset as the scrolled tabs below. `overflow-y-clip`
            // cuts the active underline at the strip's edge, as the scroller
            // does for the other tabs.
            <div className="flex shrink-0 items-center overflow-y-clip py-[3px]">
              <TabsTrigger
                value={LOGS_TAB_VALUE}
                className="px-1.5"
                aria-label="Sandbox logs"
                title="Sandbox logs"
              >
                <ListDashesIcon />
              </TabsTrigger>
            </div>
          )}
          <ScrollArea
            orientation="horizontal"
            // Scrollbar styling, scoped to the bar via its data-slot:
            // - z-10 keeps it above a tab being dragged (motion gives the dragged
            //   Reorder.Item `z-index: 1`, which would otherwise cover the bar).
            // - hidden until a mouse is detected, so trackpad users never see it.
            className={`min-w-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:z-10 ${
              usingMouse ? "" : "[&_[data-slot=scroll-area-scrollbar]]:hidden"
            }`}
          >
            <div
              className={`flex h-10 w-max items-center gap-1 py-[3px] pr-[11px] ${
                isAgentTarget ? "pl-1" : ""
              }`}
            >
              {/* Drag-reorderable chat/terminal tabs. The "+" button stays fixed
                (outside the group); only these tabs reorder.
                `values`/`onReorder` are controlled by `tabOrder`. */}
              <Reorder.Group
                // Keyed by the target so switching branches/layers REMOUNTS the
                // whole group instead of diffing this target's tab ids against the
                // previous one's. Without it, every tab from the old target exits
                // and every tab from the new one enters on each switch — the tabs
                // animate/jitter. A fresh mount (with AnimatePresence
                // `initial={false}`) paints the new target's tabs with no anim.
                key={targetKey}
                as="div"
                axis="x"
                values={orderedTabs.map((t) => t.id)}
                onReorder={handleReorder}
                // Mark a drag (or click) as in-flight so a tab settling mid-gesture
                // defers its AnimatePresence re-register until pointer release.
                onPointerDownCapture={() => {
                  draggingRef.current = true
                }}
                className="flex h-full items-stretch gap-1 overflow-visible"
              >
                {/* `key={reRegisterKey}` remounts this AnimatePresence whenever a
                  newly-created tab finishes entering, re-registering all tabs as
                  initial-present so motion stops replaying the new tab's enter on
                  its reorder-remounts (the rightward-drag flash). */}
                <AnimatePresence key={reRegisterKey} initial={false}>
                  {orderedTabs.map((tab) => (
                    <Reorder.Item
                      key={tab.id}
                      value={tab.id}
                      as="div"
                      // Animate only position, not size, during a reorder. The
                      // enter/exit on the inner wrapper drives `width` (0↔auto);
                      // a full `layout` animation here would also project the
                      // size change and fight that width tween, jittering the
                      // tab. `layout="position"` reorders by sliding neighbours
                      // aside while leaving width to the wrapper alone.
                      layout="position"
                      data-tab-id={tab.id}
                      className="flex shrink-0 items-stretch"
                    >
                      {/* Enter/exit lives on this inner wrapper, NOT the
                        Reorder.Item: the item runs a layout animation while
                        dragging (that's how neighbours slide aside), and driving
                        `width` on the same element fights that projection and
                        jitters. Here the wrapper collapses its width 0↔auto while
                        the trigger keeps its min-width, so the tab clips instead
                        of truncating its label. `overflow-x-clip` (not
                        `overflow-x-hidden`, which would force overflow-y to auto)
                        keeps the active underline — an ::after at bottom-[-5px] —
                        visible. `initial={false}` on AnimatePresence skips this on
                        first paint, so only tabs added/removed after mount
                        animate. */}
                      <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: "auto", opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        onAnimationComplete={() => markTabEntered(tab.id)}
                        className="group/tab relative flex items-stretch overflow-x-clip bg-background"
                      >
                        <TabsTrigger
                          value={tab.id}
                          className="relative min-w-[100px] cursor-grab px-2 py-1 pr-2 text-sm active:cursor-grabbing"
                        >
                          {tab.kind === "terminal" ? (
                            <TerminalTabLabel
                              terminal={tab.terminal}
                              onRename={(label) => onRenameChat(tab.id, label)}
                            />
                          ) : (
                            <ChatTabLabel
                              chat={tab.chat}
                              onRename={(label) => onRenameChat(tab.id, label)}
                            />
                          )}
                        </TabsTrigger>
                        {/* The close button sits beside the trigger, not inside it:
                          a button can't nest in the trigger's button. It shows on
                          hover and whenever it holds keyboard focus. Only the
                          selected tab's close is a Tab stop, so tabbing along
                          the strip reaches one close, not one per tab. The
                          Workspace's own chat has none: it never closes. */}
                        {tab.id === ownChatId ? null : (
                          <div className="absolute top-0 right-0 bottom-0 flex items-center bg-[var(--background)] pr-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100 focus-within:opacity-100">
                            <div className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-[var(--background)]" />
                            <IconButton
                              label={
                                tab.kind === "terminal"
                                  ? "Close terminal"
                                  : "Close chat"
                              }
                              className="relative text-muted-foreground"
                              tabIndex={tab.id === tabsValue ? 0 : -1}
                              // Keep the press from starting a tab drag.
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() =>
                                tab.kind === "terminal"
                                  ? void terminalClose.requestClose(
                                      tab.terminal,
                                      neighbourTabId(tab.id)
                                    )
                                  : onCloseChat(tab.id, neighbourTabId(tab.id))
                              }
                            >
                              <XIcon />
                            </IconButton>
                          </div>
                        )}
                      </motion.div>
                    </Reorder.Item>
                  ))}
                </AnimatePresence>
              </Reorder.Group>
              {onCreateTerminal ? (
                <ButtonGroup
                  className={`${isAgentBusy ? "" : "group/newtab"} ml-1 shrink-0`}
                >
                  <IconButton
                    label="New terminal"
                    hint={isAgentBusy ? "Sandbox still starting…" : undefined}
                    className="group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
                    onClick={() => createTerminalTab(defaultHarnessKey)}
                    disabled={isAgentBusy}
                  >
                    <PlusIcon />
                  </IconButton>
                  {/* The caret offers what "+" alone can't: a pick between
                    harnesses, and the chat of a Workspace that has none yet. A
                    Workspace never gets a second chat (#1315). */}
                  {!ownChatId || installedHarnesses.length > 1 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label={
                            ownChatId
                              ? "New terminal with…"
                              : "New chat or terminal"
                          }
                          className="w-4 min-w-0 px-0 opacity-0 group-focus-within/newtab:opacity-100 group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-hover/newtab:opacity-100 group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md aria-expanded:opacity-100 dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
                          disabled={isAgentBusy}
                        >
                          <CaretDownIcon />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {ownChatId ? null : (
                          <DropdownMenuItem onSelect={() => createChatTab()}>
                            <ChatCircleIcon className="size-3 shrink-0 text-muted-foreground" />
                            New chat
                          </DropdownMenuItem>
                        )}
                        {installedHarnesses.length > 1 ? (
                          // Multiple harnesses — a labelled section listing each
                          // by name, since "New terminal" alone wouldn't say which.
                          <>
                            {ownChatId ? null : <DropdownMenuSeparator />}
                            <DropdownMenuLabel>New terminal</DropdownMenuLabel>
                            {installedHarnesses.map((h) => (
                              <DropdownMenuItem
                                key={h.key}
                                onSelect={() => createTerminalTab(h.key)}
                              >
                                <TerminalWindowIcon className="size-3 shrink-0 text-muted-foreground" />
                                <span className="truncate">{h.label}</span>
                              </DropdownMenuItem>
                            ))}
                          </>
                        ) : (
                          // One harness (or the list isn't loaded / none
                          // installed): a single "New terminal" with no header.
                          <DropdownMenuItem
                            onSelect={() =>
                              createTerminalTab(defaultHarnessKey)
                            }
                          >
                            <TerminalWindowIcon className="size-3 shrink-0 text-muted-foreground" />
                            New terminal
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </ButtonGroup>
              ) : ownChatId ? null : (
                <span className="ml-1 inline-flex shrink-0">
                  <IconButton
                    label="New chat"
                    hint={isAgentBusy ? "Sandbox still starting…" : undefined}
                    onClick={onCreateChat}
                    disabled={isAgentBusy}
                  >
                    <PlusIcon />
                  </IconButton>
                </span>
              )}
            </div>
          </ScrollArea>
        </TabsList>
        {closedChats.length > 0 && (
          <div className="flex shrink-0 items-center px-1.5">
            <ChatHistoryMenu
              closedChats={closedChats}
              onReopen={onReopenChat}
              onDelete={onRemoveChat}
            />
          </div>
        )}
      </div>

      {agent && (
        <TabsContent
          value={LOGS_TAB_VALUE}
          className="flex-1 overflow-hidden data-[state=inactive]:hidden"
          forceMount
        >
          <LogsPanel
            sandboxName={agent.sandboxName}
            onConnected={handleLogsConnected}
          />
        </TabsContent>
      )}

      {openTabs.length === 0 && !showLogs && (
        // Every chat closed (or none yet): something to press instead of a
        // blank panel under the tab strip.
        <Empty className="rounded-none bg-background">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChatCircleIcon />
            </EmptyMedia>
            <EmptyTitle>No open chats</EmptyTitle>
            <EmptyDescription>
              {isAgentTarget
                ? "Start this Workspace's chat or a terminal."
                : "Start a chat about this Document."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={createChatTab}
            >
              <PlusIcon />
              New chat
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {openTabs.map((tab) => {
        // A terminal tab renders the in-sandbox web terminal, not the Engine
        // chat — its scrollback never enters the conversation model. It's keyed
        // by its own id (the shared live-view session) so a second client in
        // the room co-views the same live PTY.
        if (tab.kind === "terminal") {
          return (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="flex-1 overflow-hidden data-[state=inactive]:hidden"
              forceMount
            >
              <TerminalTab
                sessionId={tab.terminal.terminalSessionId}
                roomId={roomId}
                sandboxName={agent?.sandboxName}
                sandboxStatus={agent?.status}
                harnessKey={tab.terminal.harnessKey}
              />
            </TabsContent>
          )
        }
        const chat = tab.chat
        // First chat for this target — drives auto branch/chat naming.
        const isFirst = !chatSessions.some(
          (c) =>
            c.id !== chat.id && !!chat.branchId && c.branchId === chat.branchId
        )
        return (
          <TabsContent
            key={chat.id}
            value={chat.id}
            className="flex-1 overflow-hidden data-[state=inactive]:hidden"
            forceMount
          >
            <AgentChat
              chatId={chat.id}
              roomId={roomId}
              target={chatTarget}
              sandboxStatus={agent?.status}
              isFirstChat={isFirst}
              planMode={chat.planMode}
              onPlanModeChange={(pm) => onPlanModeChange(chat.id, pm)}
              model={chat.model}
              onModelChange={(m) => onModelChange(chat.id, m)}
              isActive={!showLogs && chat.id === activeTab}
              onOpenWorkspaceChat={
                ownChatId && chat.id !== ownChatId
                  ? () => onSelectChat(ownChatId)
                  : undefined
              }
            />
          </TabsContent>
        )
      })}
      {terminalClose.dialog}
    </Tabs>
  )
}

/**
 * The header's name for the panel's current target: the shared Workspace
 * mention without its PR, and hovering it shows the Workspace hover card.
 */
function TargetPill({ target }: { target: TabbedTarget }) {
  const stateOf = useWorkspaceStates()
  // State icon and plain name (#974); no PR badge, since the header keeps its
  // own PR button on the right (#799).
  return (
    <WorkspaceHoverCard branchId={target.agent.id} side="bottom" align="start">
      <span className="flex min-w-0">
        <WorkspaceMention
          branch={target.agent}
          state={stateOf(target.agent)}
          pr={false}
          className="flex-initial text-sm"
        />
      </span>
    </WorkspaceHoverCard>
  )
}
