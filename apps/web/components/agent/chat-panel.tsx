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
  Plus,
  X,
  Archive,
  RotateCcw,
  PanelRightClose,
  ChevronsUpDown,
  ChevronDown,
  Check,
  GitPullRequest,
  ArrowUpRight,
  Logs,
  MessageCircle,
  SquareTerminal,
} from "lucide-react"
import { AnimatePresence, motion, Reorder } from "motion/react"
import { inputStore } from "@/lib/input-store"
import { Spinner } from "@workspace/ui/components/spinner"
import { GripSpinner } from "@/components/grip-spinner"
import { EditableText } from "@workspace/ui/components/editable-text"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { AgentChat } from "./agent-chat"
import { LogsPanel } from "./logs-panel"
import { TerminalTab } from "./terminal-tab"
import { BranchBadge } from "@/components/branch-badge"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
  TabKind,
  TerminalTabData,
} from "@/lib/types"
import { CHAT_TARGETABLE_LAYER_KINDS, getLayerKind } from "@/lib/layer-kinds"
import {
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  readLastTabKind,
  readTabOrder,
  writeLastHarnessKey,
  writeLastTabKind,
  writeTabOrder,
} from "@/lib/canvas/tab-kind"
import { useSession } from "@/lib/auth-client"
import { useInstalledHarnesses } from "@/hooks/use-installed-harnesses"
import type { AgentMessage } from "@/lib/agent/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"
import { chatStore } from "@/lib/chat-store"

const LOGS_TAB_VALUE = "__sandbox_logs__"

// Horizontal scrolling for the tab strip is driven imperatively (sticky
// right-edge, reveal-on-add) against the Radix ScrollArea's viewport. We reach
// it through this stable data-attribute rather than threading a ref through the
// shared ScrollArea wrapper (which forwards to its Root, not the viewport).
const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'

// Within how many px of the right edge counts as "pinned right". A couple of
// px of slack absorbs sub-pixel rounding from fractional widths/zoom.
const RIGHT_EDGE_SLACK_PX = 2

// Scroll `viewport` the minimum amount so `el` is fully visible, with a little
// padding so a revealed tab isn't flush against the edge.
function ensureTabVisible(viewport: HTMLElement, el: HTMLElement) {
  const vpRect = viewport.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const pad = 8
  if (elRect.left < vpRect.left) {
    viewport.scrollLeft -= vpRect.left - elRect.left + pad
  } else if (elRect.right > vpRect.right) {
    viewport.scrollLeft += elRect.right - vpRect.right + pad
  }
}

// Scan a chat's messages newest-first for the most recent `create_pr` tool
// result and pull the PR url/number out of its output. Pure over `messages`
// so the `useMemo` below is a single reactive call the compiler can preserve.
function findLatestPr(
  messages: AgentMessage[]
): { url: string; number: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "tool_result" && m.name === "create_pr") {
      const url = m.output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
      const num = m.output.match(/#(\d+)/)?.[1]
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
  "max-w-[100px] min-w-0 rounded-xs px-0.5 py-0.5 -mx-0.5 -my-0.5"
// Edit-mode-only decoration. Uses theme tokens (not the sidebar rows' hardcoded
// white) so it reads against the tab strip.
const TAB_LABEL_EDIT_CLASS =
  "relative z-10 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-background text-foreground shadow-sm ring-[0.5px] ring-border"

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
        <GripSpinner className="size-3 shrink-0 text-muted-foreground" />
      ) : hasUnread ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
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
 * Tab label for a terminal tab. Visibly distinct from chat tabs — a terminal
 * glyph and a monospace label — so it's obvious which guarantees apply
 * (ephemeral + BYO harness, not durable + shared chat). Reads no chat-store
 * status: a terminal tab has no streaming/unread conversation state.
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

/**
 * The chat panel can target one of two top-level kinds:
 *  - an *agent* (sandbox-backed flow): file editing, git, PR creation, logs.
 *  - a *layer* of any kind whose `LayerKindDescriptor.canBeChatTarget` is
 *    true (currently just markdownLayers). The `layerKind` discriminator
 *    determines which descriptor's icon/label drives the chrome and which
 *    server-side toolset runs.
 *
 * New layer kinds become valid chat targets by setting
 * `canBeChatTarget: true` on their descriptor and registering a server-side
 * `chat-target-kinds` entry — no changes here needed.
 */
export type ChatPanelTarget =
  | { kind: "agent"; agent: BranchData }
  | {
      kind: "layer"
      layerKind: string
      layer: { id: string } & Record<string, unknown>
    }

interface ChatPanelProps {
  target: ChatPanelTarget
  agents: BranchData[]
  markdownLayers: MarkdownLayerData[]
  onSelectAgent: (id: string) => void
  /** Generalised "pick a layer-kind target" callback — receives the kind
   *  ("markdown-layer", future kinds, …) and the layer id. */
  onSelectLayer: (layerKind: string, layerId: string) => void
  chatSessions: ChatSessionData[]
  /** This client's local terminal tabs for the current target. Held in their
   *  own collection (never `chatSessions`), so a terminal can't enter the
   *  conversation model. Empty/absent for non-agent (layer) targets. */
  terminalTabs?: TerminalTabData[]
  selectedChatId: string | null
  roomId: string
  onSelectChat: (chatId: string | null) => void
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
  onBranchRename: (branch: string) => void
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
  onCollapse?: () => void
  onLogsReady?: () => void
  disableBranchPicker?: boolean
}

export function ChatPanel({
  target,
  agents,
  markdownLayers,
  onSelectAgent,
  onSelectLayer,
  chatSessions,
  terminalTabs,
  selectedChatId,
  roomId,
  onSelectChat,
  onCreateChat,
  onCreateTerminal,
  onRenameChat,
  onCloseChat,
  onReopenChat,
  onBranchRename,
  onPlanModeChange,
  onModelChange,
  diffStats,
  branchPr,
  onCollapse,
  onLogsReady,
  disableBranchPicker,
}: ChatPanelProps) {
  const isAgentTarget = target.kind === "agent"
  const agent = target.kind === "agent" ? target.agent : null
  // Layer-kind targets (currently just markdownLayers) are routed through the
  // shared `LayerKindDescriptor` registry; the chrome (target pill,
  // picker entry) reads icon/label from there so future kinds light up
  // without changes to this file.
  const layerTarget = target.kind === "layer" ? target : null

  // The tab strip interleaves two distinct tab types — durable chats and
  // ephemeral terminals — in one createdAt-ordered row. We model each as a
  // tagged item rather than a shared base type so the conversation model can
  // never structurally hold a terminal.
  const openTabs = useMemo<OpenTab[]>(() => {
    const items: OpenTab[] = [
      ...chatSessions
        .filter((c) => !c.closedAt)
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
  }, [chatSessions, terminalTabs])

  const closedChats = useMemo(
    () =>
      [...chatSessions]
        .filter((c) => c.closedAt)
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [chatSessions]
  )

  // Auto-select the first open tab (chat or terminal) if none selected
  useEffect(() => {
    if (!selectedChatId && openTabs.length > 0) {
      onSelectChat(openTabs[0].id)
    }
  }, [selectedChatId, openTabs, onSelectChat])

  const activeTab = selectedChatId ?? openTabs[0]?.id ?? ""
  const chatHistoryPr = useLatestPr(activeTab)
  const displayPr: { url: string; number: string } | null =
    chatHistoryPr ??
    (branchPr ? { url: branchPr.url, number: String(branchPr.number) } : null)
  const isAgentBusy = agent
    ? agent.status === "creating" || agent.status === "starting"
    : false
  const allChatIds = useMemo(
    () => chatSessions.map((c) => c.id),
    [chatSessions]
  )
  const anyChatStreaming = useAnyChatStreaming(allChatIds)
  const [showLogs, setShowLogs] = useState(false)
  const tabsValue = showLogs ? LOGS_TAB_VALUE : activeTab

  // Sticky new-tab action. Read the last-used kind from localStorage during
  // render (SSR-safe — `readLastTabKind` returns "chat" when `window` is
  // undefined) rather than syncing it in via an effect, which would trigger a
  // cascading render on mount. `onCreateTerminal` is absent for layer targets,
  // so the sticky kind can only ever be "terminal" when terminals are actually
  // creatable here.
  const [lastTabKind, setLastTabKind] = useState<TabKind>(readLastTabKind)
  const stickyTabKind: TabKind =
    onCreateTerminal && lastTabKind === "terminal" ? "terminal" : "chat"

  // The harnesses installed in this deployment's sandboxes — the menu the caret
  // draws (#290). Only fetched when terminals are creatable here (agent target).
  const { data: session } = useSession()
  const userId = session?.user.id
  const installedHarnesses = useInstalledHarnesses(!!onCreateTerminal)

  // The harness the sticky "+" launches when its kind is "terminal": the
  // operator's last pick if it's still installed, else the first installed
  // harness, else the catalog default (list not loaded yet / none installed).
  // Read per-User from localStorage during render — a hint only, never
  // authoritative (a tab's harness lives on its `terminal_tab.harnessKey` row),
  // so a stale value can't change an existing tab. A harness pick flips
  // `lastTabKind` (a state update), which re-renders and re-reads this fresh.
  const storedHarnessKey = userId ? readLastHarnessKey(userId) : null
  const defaultHarnessKey =
    storedHarnessKey &&
    installedHarnesses.some((h) => h.key === storedHarnessKey)
      ? storedHarnessKey
      : (installedHarnesses[0]?.key ?? DEFAULT_HARNESS_KEY)

  const createChatTab = useCallback(() => {
    setLastTabKind("chat")
    writeLastTabKind("chat")
    onCreateChat()
  }, [onCreateChat])

  // Launch a terminal with `harnessKey` and make it the sticky default: the "+"
  // button now repeats *this* harness, and (keyed per User) it survives reload.
  const createTerminalTab = useCallback(
    (harnessKey: string) => {
      setLastTabKind("terminal")
      writeLastTabKind("terminal")
      if (userId) writeLastHarnessKey(userId, harnessKey)
      onCreateTerminal?.(harnessKey)
    },
    [onCreateTerminal, userId]
  )

  // The sticky "+" action: repeat the last-used kind, and for terminals the
  // last-used (or default) harness.
  const createStickyTab = useCallback(() => {
    if (stickyTabKind === "terminal") createTerminalTab(defaultHarnessKey)
    else createChatTab()
  }, [stickyTabKind, defaultHarnessKey, createTerminalTab, createChatTab])

  // Reset the logs-visible flag whenever the chat target changes so a
  // freshly-selected target (whose LogsPanel is still fetching, if any)
  // doesn't inherit the previous target's "logs tab open" state. Done during
  // render via the previous-value pattern rather than in an effect, which
  // would cascade an extra render after the target switch.
  const targetKey = agent?.id ?? layerTarget?.layer.id ?? ""
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

  // Keep `pinnedRightRef` current as the operator scrolls, and re-pin to the
  // right edge whenever the strip's content grows while they're parked there
  // (e.g. a tab added by another client in the room). The ResizeObserver
  // watches the viewport's content wrapper, which widens as tabs are added.
  useEffect(() => {
    const vp = getViewport()
    if (!vp) return
    const updatePinned = () => {
      // Only "pinned right" when the strip actually overflows *and* the operator
      // is parked at that right edge. Without the overflow guard, a strip that
      // fits (or isn't laid out yet on mount) reads as pinned — and the
      // ResizeObserver's initial fire would then jump scrollLeft to the end,
      // landing a freshly-loaded strip scrolled all the way right.
      const overflow = vp.scrollWidth - vp.clientWidth
      pinnedRightRef.current =
        overflow > RIGHT_EDGE_SLACK_PX &&
        overflow - vp.scrollLeft <= RIGHT_EDGE_SLACK_PX
    }
    updatePinned()
    vp.addEventListener("scroll", updatePinned, { passive: true })
    const content = vp.firstElementChild
    const ro = content
      ? new ResizeObserver(() => {
          if (pinnedRightRef.current) vp.scrollLeft = vp.scrollWidth
        })
      : null
    if (content && ro) ro.observe(content)
    return () => {
      vp.removeEventListener("scroll", updatePinned)
      ro?.disconnect()
    }
  }, [getViewport])

  // When a tab is added, reveal the right end — the new tab lands there, and
  // this also brings the "+" button back into view.
  useEffect(() => {
    const prev = prevTabCountRef.current
    prevTabCountRef.current = openTabs.length
    if (openTabs.length > prev) {
      const vp = getViewport()
      if (!vp) return
      vp.scrollLeft = vp.scrollWidth
      pinnedRightRef.current = true
    }
  }, [openTabs.length, getViewport])

  // Reveal the active tab whenever the selection changes (e.g. picking a tab
  // that's scrolled off-screen, or the freshly-created tab becoming active).
  useEffect(() => {
    if (!selectedChatId) return
    const vp = getViewport()
    if (!vp) return
    const el = vp.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(selectedChatId)}"]`
    )
    if (el) ensureTabVisible(vp, el)
  }, [selectedChatId, getViewport])

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

  const handleCreatePr = () => {
    if (!activeTab) return
    inputStore.send(
      activeTab,
      "Create a pull request for the changes on this branch."
    )
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
      <div className="flex h-12 items-center bg-background px-3">
        {onCollapse && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="mr-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
                  onClick={onCollapse}
                >
                  <PanelRightClose />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Collapse chat <Kbd>⌘I</Kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {disableBranchPicker ? (
          <TargetPill target={target} />
        ) : (
          <TargetPicker
            agents={agents}
            markdownLayers={markdownLayers}
            target={target}
            onSelectAgent={onSelectAgent}
            onSelectLayer={onSelectLayer}
          />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Diff stats and the PR button are agent-only — there's no
              git/branch concept for a doc target. */}
          {isAgentTarget &&
            diffStats &&
            (diffStats.additions > 0 || diffStats.deletions > 0) && (
              <span className="flex items-center gap-1 font-mono text-[10px]">
                <span className="text-green-700 dark:text-green-300">
                  +{diffStats.additions}
                </span>
                <span className="text-red-700 dark:text-red-300">
                  -{diffStats.deletions}
                </span>
              </span>
            )}
          {isAgentTarget &&
            (displayPr ? (
              <Button size="xs" variant="outline" asChild>
                <a
                  href={displayPr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group"
                >
                  <GitPullRequest />#{displayPr.number}
                  <ArrowUpRight className="opacity-60 group-hover:opacity-100" />
                </a>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={handleCreatePr}
                disabled={!activeTab || isAgentBusy || anyChatStreaming}
                title={
                  isAgentBusy
                    ? "Sandbox still starting…"
                    : anyChatStreaming
                      ? "Agent is working on this branch…"
                      : undefined
                }
              >
                <GitPullRequest />
                Create PR
              </Button>
            ))}
        </div>
      </div>
      <div
        ref={tabBarRef}
        className="flex border-b border-border bg-background"
      >
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
          <TabsList variant="line" className="h-9 px-2">
            {isAgentTarget && (
              <TabsTrigger
                value={LOGS_TAB_VALUE}
                className="shrink-0 px-1.5"
                aria-label="Sandbox logs"
                title="Sandbox logs"
              >
                <Logs className="size-3.5" />
              </TabsTrigger>
            )}
            {/* Drag-reorderable chat/terminal tabs. The logs trigger and the
                "+" button stay fixed (outside the group); only these tabs
                reorder. `values`/`onReorder` are controlled by `tabOrder`. */}
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
                      className="flex items-stretch overflow-x-clip bg-background"
                    >
                      <TabsTrigger
                        value={tab.id}
                        className="group/tab relative min-w-[100px] cursor-grab px-2 py-1 pr-2 text-xs active:cursor-grabbing"
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
                        <div className="absolute top-0 right-0 bottom-0 flex items-center bg-[var(--background)] pr-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100">
                          <div className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-[var(--background)]" />
                          <span
                            role="button"
                            tabIndex={0}
                            title="Close"
                            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            // The X lives inside a Radix TabsTrigger, which selects
                            // the tab on pointer/mouse-down and on focus. Stop those
                            // from reaching the trigger and preventDefault so the X
                            // never takes focus (whose focusin would bubble up and
                            // auto-activate the tab) — otherwise closing an
                            // unselected tab selects it first.
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onCloseChat(tab.id, neighbourTabId(tab.id))
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                e.stopPropagation()
                                onCloseChat(tab.id, neighbourTabId(tab.id))
                              }
                            }}
                          >
                            <X className="size-3" />
                          </span>
                        </div>
                      </TabsTrigger>
                    </motion.div>
                  </Reorder.Item>
                ))}
              </AnimatePresence>
            </Reorder.Group>
            {onCreateTerminal ? (
              <ButtonGroup
                className={`${isAgentBusy ? "" : "group/newtab"} ml-1 shrink-0`}
              >
                <TooltipProvider delayDuration={500}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
                        onClick={createStickyTab}
                        disabled={isAgentBusy}
                        aria-label={
                          stickyTabKind === "terminal"
                            ? "New terminal"
                            : "New chat"
                        }
                      >
                        <Plus className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isAgentBusy
                        ? "Sandbox still starting…"
                        : stickyTabKind === "terminal"
                          ? "New terminal"
                          : "New chat"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="w-4 min-w-0 px-0 opacity-0 group-focus-within/newtab:opacity-100 group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-hover/newtab:opacity-100 group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md aria-expanded:opacity-100 dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
                      disabled={isAgentBusy}
                      title="New chat or terminal"
                      aria-label="New chat or terminal"
                    >
                      <ChevronDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => createChatTab()}>
                      <MessageCircle className="size-3 shrink-0 text-muted-foreground" />
                      New chat
                    </DropdownMenuItem>
                    {installedHarnesses.length > 1 ? (
                      // Multiple harnesses — a labelled section listing each by
                      // name, since "New terminal" alone wouldn't say which.
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                          New terminal
                        </DropdownMenuLabel>
                        {installedHarnesses.map((h) => (
                          <DropdownMenuItem
                            key={h.key}
                            onSelect={() => createTerminalTab(h.key)}
                          >
                            <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{h.label}</span>
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : (
                      // One harness (or the list isn't loaded / none installed) —
                      // there's nothing to choose between, so collapse to a single
                      // "New terminal" with no section header. Opens the lone
                      // harness, else the default, so the menu never strands the
                      // operator.
                      <DropdownMenuItem
                        onSelect={() =>
                          createTerminalTab(
                            installedHarnesses[0]?.key ?? DEFAULT_HARNESS_KEY
                          )
                        }
                      >
                        <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
                        New terminal
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-1 shrink-0"
                onClick={onCreateChat}
                disabled={isAgentBusy}
                title={isAgentBusy ? "Sandbox still starting…" : "New chat"}
              >
                <Plus className="size-3" />
              </Button>
            )}
          </TabsList>
        </ScrollArea>
        {closedChats.length > 0 && (
          <div className="flex shrink-0 items-center px-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" title="Closed chats">
                  <Archive className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {closedChats.map((chat) => (
                  <DropdownMenuItem
                    key={chat.id}
                    className="flex items-center gap-2"
                    onSelect={() => onReopenChat(chat.id)}
                  >
                    <RotateCcw className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{chat.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
        // First chat for this target — drives auto branch/chat naming on the
        // agent flow; for doc chats it's just used to skip naming logic.
        const isFirst = !chatSessions.some(
          (c) =>
            c.id !== chat.id &&
            ((chat.branchId && c.branchId === chat.branchId) ||
              (chat.markdownLayerId &&
                c.markdownLayerId === chat.markdownLayerId))
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
              sandboxId={agent?.id}
              sandboxName={agent?.sandboxName}
              sandboxStatus={agent?.status}
              branch={agent?.ref}
              markdownLayerId={
                layerTarget?.layerKind === "markdown-layer"
                  ? layerTarget.layer.id
                  : undefined
              }
              isFirstChat={isFirst}
              autoNamedBranch={agent?.autoNamedBranch}
              planMode={chat.planMode}
              onPlanModeChange={(pm) => onPlanModeChange(chat.id, pm)}
              model={chat.model}
              onModelChange={(m) => onModelChange(chat.id, m)}
              onBranchRename={onBranchRename}
              onChatRename={(label) => onRenameChat(chat.id, label)}
            />
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

/**
 * Renders the picker pill for the panel's current target. The agent
 * branch flavour stays a branch badge (its chrome is unique); every layer
 * kind renders generically through its `LayerKindDescriptor` (icon +
 * label), so adding a new chat-targetable kind doesn't touch this file.
 */
function TargetPill({ target }: { target: ChatPanelTarget }) {
  if (target.kind === "agent") {
    return (
      <BranchBadge
        branch={target.agent.ref}
        colorKey={target.agent.id}
        colorIndex={target.agent.colorIndex}
        className="px-1.5 py-0 text-[11px]"
      />
    )
  }
  const descriptor = getLayerKind(target.layerKind)
  if (!descriptor) return null
  const label = descriptor.getLabel(target.layer as never)
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="max-w-[14rem] truncate">{label}</span>
    </span>
  )
}

/**
 * Unified picker for the chat panel's target. Lists every available agent
 * branch *and* every chat-targetable layer kind. Sections are driven by
 * `CHAT_TARGETABLE_LAYER_KINDS` from the layer-kinds registry, so a new
 * layer kind that opts in via `canBeChatTarget: true` automatically gets
 * its own section here without any edits to this component.
 */
function TargetPicker({
  agents,
  markdownLayers,
  target,
  onSelectAgent,
  onSelectLayer,
}: {
  agents: BranchData[]
  /** All chat-targetable layers, keyed by kind. The picker renders one
   *  CommandGroup per kind in registry order. */
  markdownLayers: MarkdownLayerData[]
  target: ChatPanelTarget
  onSelectAgent: (id: string) => void
  onSelectLayer: (layerKind: string, layerId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pickableAgents = agents.filter(
    (a) => a.ref && a.status !== "error" && a.status !== "stopped"
  )

  // Keyed by `descriptor.kind` so the picker loop below can look up each
  // chat-targetable kind without a per-kind branch.
  const layersByKind: Record<
    string,
    Array<{ id: string } & Record<string, unknown>>
  > = {
    "markdown-layer": markdownLayers,
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-0.5">
          <TargetPill target={target} />
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="start">
        <Command>
          <CommandInput placeholder="Search branches and layers..." />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {pickableAgents.length > 0 && (
              <CommandGroup heading="Branches">
                {pickableAgents.map((a) => {
                  const isBusy =
                    a.status === "creating" || a.status === "starting"
                  const isCurrent =
                    target.kind === "agent" && a.id === target.agent.id
                  return (
                    <CommandItem
                      key={a.id}
                      value={`branch ${a.ref}`}
                      onSelect={() => {
                        onSelectAgent(a.id)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={`shrink-0 ${isCurrent ? "" : "opacity-0"}`}
                      />
                      <BranchBadge
                        branch={a.ref}
                        colorKey={a.id}
                        colorIndex={a.colorIndex}
                        className="px-1.5 py-0 text-[11px]"
                      />
                      {isBusy && <Spinner className="ml-auto size-3" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {CHAT_TARGETABLE_LAYER_KINDS.map((descriptor) => {
              const items = layersByKind[descriptor.kind] ?? []
              if (items.length === 0) return null
              return (
                <CommandGroup
                  key={descriptor.kind}
                  heading={descriptor.pluralLabel}
                >
                  {items.map((item) => {
                    const isCurrent =
                      target.kind === "layer" &&
                      target.layerKind === descriptor.kind &&
                      item.id === target.layer.id
                    const label = descriptor.getLabel(item as never)
                    return (
                      <CommandItem
                        key={item.id}
                        value={`${descriptor.kind} ${label}`}
                        onSelect={() => {
                          onSelectLayer(descriptor.kind, item.id)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={`shrink-0 ${isCurrent ? "" : "opacity-0"}`}
                        />
                        <span className="truncate">{label}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
