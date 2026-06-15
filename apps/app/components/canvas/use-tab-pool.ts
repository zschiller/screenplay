import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
} from "react"
import { nanoid } from "nanoid"

import { chatStore } from "@/lib/chat-store"
import {
  buildTabPool,
  resolveTabClose,
  type TabCloseOutcome,
  type TabPoolTarget,
} from "@/lib/chat/tab-pool"
import {
  createTerminalTab,
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  readLastTabKind,
} from "@/lib/canvas/tab-kind"
import {
  createTerminalTabAction,
  deleteTerminalTabAction,
  killTerminalSessionAction,
} from "@/lib/terminal-tabs-actions"
import type {
  BranchData,
  ChatSessionData,
  TabKind,
  TerminalTabData,
} from "@/lib/types"

/**
 * Tab Pool controller (PRD #563) — the apply-side of a Chat Target's tab pool,
 * lifted out of `components/canvas/canvas.tsx`. The component renders the tab
 * strip and calls the verbs this hook returns (`open`, `close`, `remove`,
 * `select`, `rename`, `reopen`, `seed`); the effects — the chat-store and Y.Doc
 * tab writes, the Terminal Tab server actions, the tmux / PTY teardown, and the
 * selection writes — live here, in one place, rather than smeared across the
 * Canvas surface.
 *
 * The pure decision core stays in `lib/chat/tab-pool.ts`: {@link buildTabPool}
 * scopes the room-wide lists down to one target's pool (the agent-vs-doc split
 * resolved once, by construction) and {@link resolveTabClose} decides what
 * survives, where selection lands, and whether to respawn. This controller is
 * the adapter that applies that outcome — "decide purely, apply at the call
 * site", with the call site now the controller rather than the component.
 *
 * The never-empty invariant ("while the target lives, its pool is never empty")
 * lives here too, with the writes that uphold it: a respawn recreates the
 * target's preferred default tab so the panel is never left blank.
 *
 * Modelled on the Branch Intake controller (#562): plain injected seams, no
 * inline JSX handlers, `chatStore` imported directly.
 */
export interface TabPoolDeps {
  /** Chat-session writers (thin wrappers over the Canvas Operation verbs). */
  addChatSession: (id: string, data: ChatSessionData) => void
  updateChatSession: (id: string, patch: Partial<ChatSessionData>) => void
  removeChatSession: (id: string) => void
  roomId: string
  /** The signed-in User's id, used to resolve the sticky harness pref (#290). */
  userId: string | undefined
  agents: BranchData[]
  chatSessions: ChatSessionData[]
  /** Client-local Terminal Tabs — a distinct type, never in `chatSessions`. */
  localTerminals: TerminalTabData[]
  setLocalTerminals: Dispatch<SetStateAction<TerminalTabData[]>>
  isLocalTerminal: (id: string | null) => boolean
  selectedChatId: string | null
  setSelectedChatId: (id: string | null) => void
  setSelectedAgentId: (id: string | null) => void
  setSelectedDocumentChatTargetId: (id: string | null) => void
  /** Per-target "remember the last-selected chat" refs (UI-only state). */
  selectedChatByAgentRef: RefObject<Record<string, string>>
  selectedChatByDocumentRef: RefObject<Record<string, string>>
}

/**
 * What to open. A discriminated union so the component calls intent — a chat or
 * terminal tab on an agent Branch, or a chat on a document — rather than the
 * effect sequence each kind requires.
 */
export type OpenTabSpec =
  | { kind: "chat"; branchId: string }
  | { kind: "terminal"; branchId: string; harnessKey: string }
  | { kind: "doc-chat"; markdownLayerId: string }

export interface TabPool {
  /** Create a new tab on a target and select it. */
  open: (spec: OpenTabSpec) => void
  /**
   * Close a tab. A Chat Session is archived (`closedAt` stamped, reopenable); a
   * Terminal Tab is dropped and its backing tmux / PTY session killed. The
   * never-empty invariant respawns the target's default when the last tab goes.
   */
  close: (chatId: string, nextSelectedId?: string) => void
  /** Permanently delete a Chat Session (or close a Terminal Tab). */
  remove: (chatId: string) => void
  /** Move selection to a tab (or clear it with `null`). */
  select: (chatId: string | null) => void
  /** Rename a Chat Session or Terminal Tab. */
  rename: (chatId: string, label: string) => void
  /** Restore a previously-closed Chat Session into its pool. */
  reopen: (chatId: string) => void
  /**
   * Seed a Branch's preferred default tab (chat or terminal). The handoff Branch
   * Intake (#562) calls so intake and the Tab Pool agree on "the default tab".
   * Selects the new tab unless `select` is false. Returns the new tab id.
   */
  seed: (
    branchId: string,
    kind: TabKind,
    options?: { select?: boolean }
  ) => string
}

export function useTabPool(deps: TabPoolDeps): TabPool {
  const {
    addChatSession,
    updateChatSession,
    removeChatSession,
    roomId,
    userId,
    agents,
    chatSessions,
    localTerminals,
    setLocalTerminals,
    isLocalTerminal,
    selectedChatId,
    setSelectedChatId,
    setSelectedAgentId,
    setSelectedDocumentChatTargetId,
    selectedChatByAgentRef,
    selectedChatByDocumentRef,
  } = deps

  /**
   * Create the user's preferred default tab (chat or terminal) for an agent
   * branch. This is the one place the "open a fresh branch" and "the last tab
   * was just closed" flows share, so the auto-created tab always follows the
   * per-user pref ({@link readLastTabKind}) rather than whatever kind happened
   * to be closed. Selects the new tab unless `select` is false (branch-create
   * defers selection to when the sandbox is ready). Returns the new tab id.
   */
  const seed = useCallback(
    (branchId: string, kind: TabKind, options?: { select?: boolean }) => {
      const select = options?.select !== false
      if (kind === "terminal") {
        const tab = createTerminalTab({
          id: nanoid(),
          branchId,
          createdAt: Date.now(),
          // A terminal-default tab launches the same harness as the "+" button:
          // the operator's last-selected harness (#290), falling back to the
          // catalog default. If it's since been uninstalled the server resolves
          // it to a plain shell, so a stale pref degrades gracefully.
          harnessKey:
            (userId ? readLastHarnessKey(userId) : null) ?? DEFAULT_HARNESS_KEY,
        })
        setLocalTerminals((prev) => [...prev, tab])
        if (select) setSelectedChatId(tab.id)
        createTerminalTabAction({
          roomId,
          branch: branchId,
          id: tab.id,
          label: tab.label,
          harnessKey: tab.harnessKey,
          createdAt: tab.createdAt,
        }).catch((err) => {
          console.error("Failed to persist terminal tab", err)
        })
        return tab.id
      }
      const id = nanoid()
      addChatSession(id, {
        id,
        branchId,
        label: "Untitled",
        createdAt: Date.now(),
      })
      if (select) setSelectedChatId(id)
      return id
    },
    [roomId, addChatSession, userId, setLocalTerminals, setSelectedChatId]
  )

  // Apply a Tab Pool close decision (the effect half of the pure
  // `resolveTabClose`). A respawn recreates the target's preferred default tab
  // so the panel is never left empty — for an agent that's whichever kind the
  // per-user pref names (chat or terminal, via seed); a doc target always gets a
  // fresh chat. With no respawn, selection moves only when the decision says so
  // (`nextSelectedId` set); an omitted value leaves the current selection in
  // place.
  const applyTabCloseOutcome = useCallback(
    (outcome: TabCloseOutcome) => {
      const { respawn, nextSelectedId } = outcome
      if (respawn) {
        if (respawn.target === "agent") {
          // Creates + selects the replacement (and persists it when it's a
          // terminal), so no inline add/select here.
          seed(respawn.branchId, readLastTabKind())
        } else {
          const newId = nanoid()
          addChatSession(newId, {
            id: newId,
            markdownLayerId: respawn.markdownLayerId,
            label: "Untitled",
            createdAt: Date.now(),
          })
          setSelectedChatId(newId)
          selectedChatByDocumentRef.current[respawn.markdownLayerId] = newId
        }
        return
      }
      if (nextSelectedId !== undefined) setSelectedChatId(nextSelectedId)
    },
    [seed, addChatSession, setSelectedChatId, selectedChatByDocumentRef]
  )

  // Close a local terminal tab: it's ephemeral, so closing simply drops it
  // (no closed-chats archive). The Tab Pool decision keeps the never-empty
  // invariant — if this terminal is the last tab on its branch (no sibling
  // terminal and no open chat) it returns a respawn for the user's preferred
  // default kind (which may be a chat); otherwise, if it was selected, it picks
  // the fallback selection. We then apply the row/session teardown effects.
  const closeTerminal = useCallback(
    (id: string, nextSelectedId?: string) => {
      const closing = localTerminals.find((t) => t.id === id)
      const branchId = closing?.branchId
      setLocalTerminals((prev) => prev.filter((t) => t.id !== id))
      if (branchId) {
        const pool = buildTabPool(
          { kind: "agent", branchId },
          chatSessions,
          localTerminals
        )
        const outcome = resolveTabClose(pool, id, selectedChatId, nextSelectedId)
        applyTabCloseOutcome(outcome)
      } else if (selectedChatId === id) {
        // No branch to form a pool around (e.g. the row is already gone); just
        // clear the selection if it was the selected tab.
        setSelectedChatId(nextSelectedId ?? null)
      }
      // Closing an X permanently deletes the row (a reload alone never does).
      deleteTerminalTabAction({ roomId, id }).catch((err) => {
        console.error("Failed to delete terminal tab", err)
      })
      // …and kills the tab's tmux session so its shell + any running process
      // (e.g. a harness) actually stops, not just the tab UI. Separate from the
      // row delete so a down sandbox can't keep the tab around. Best-effort: a
      // session that's already gone resolves fine.
      const sandboxName = agents.find((a) => a.id === branchId)?.sandboxName
      if (closing && sandboxName) {
        killTerminalSessionAction({
          roomId,
          sandboxName,
          terminalSessionId: closing.terminalSessionId,
        }).catch((err) => {
          console.error("Failed to kill terminal session", err)
        })
      }
    },
    [
      selectedChatId,
      chatSessions,
      localTerminals,
      roomId,
      agents,
      setLocalTerminals,
      setSelectedChatId,
      applyTabCloseOutcome,
    ]
  )

  const open = useCallback(
    (spec: OpenTabSpec) => {
      if (spec.kind === "chat") {
        const id = nanoid()
        const data: ChatSessionData = {
          id,
          branchId: spec.branchId,
          label: "Untitled",
          createdAt: Date.now(),
        }
        addChatSession(id, data)
        setSelectedAgentId(spec.branchId)
        setSelectedChatId(id)
        return
      }
      if (spec.kind === "terminal") {
        // A new terminal tab builds a `TerminalTabData` (using the tab id as the
        // shared live-view `terminalSessionId`) held in the client-local
        // `localTerminals` collection — never in `chatSessions` — so the panel
        // mounts a terminal body instead of the Engine chat and the conversation
        // model can never, by type, see it.
        const id = nanoid()
        const tab = createTerminalTab({
          id,
          branchId: spec.branchId,
          createdAt: Date.now(),
          // The harness the operator picked (or the sticky default) — #290.
          // Stored on the row so it's authoritative and survives reload/rebuild.
          harnessKey: spec.harnessKey,
        })
        setLocalTerminals((prev) => [...prev, tab])
        setSelectedAgentId(spec.branchId)
        setSelectedChatId(id)
        // Persist so the tab survives reload and follows the User across
        // devices. Optimistic: the tab is already in local state; a failed write
        // only means it won't be restored next load.
        createTerminalTabAction({
          roomId,
          branch: spec.branchId,
          id: tab.id,
          label: tab.label,
          harnessKey: tab.harnessKey,
          createdAt: tab.createdAt,
        }).catch((err) => {
          console.error("Failed to persist terminal tab", err)
        })
        return
      }
      // doc-chat: mirrors a chat tab but stamps `markdownLayerId` instead of a
      // branch, so the server picks the doc-targeted flow when this chat first
      // sends a message.
      const id = nanoid()
      addChatSession(id, {
        id,
        markdownLayerId: spec.markdownLayerId,
        label: "Untitled",
        createdAt: Date.now(),
      })
      setSelectedAgentId(null)
      setSelectedDocumentChatTargetId(spec.markdownLayerId)
      setSelectedChatId(id)
      selectedChatByDocumentRef.current[spec.markdownLayerId] = id
    },
    [
      addChatSession,
      roomId,
      setLocalTerminals,
      setSelectedAgentId,
      setSelectedChatId,
      setSelectedDocumentChatTargetId,
      selectedChatByDocumentRef,
    ]
  )

  const close = useCallback(
    (chatId: string, nextSelectedId?: string) => {
      if (isLocalTerminal(chatId)) {
        closeTerminal(chatId, nextSelectedId)
        return
      }
      const chat = chatSessions.find((c) => c.id === chatId)
      // Resolve the target's pool (agent vs doc, kept apart in buildTabPool) and
      // let the pure Tab Pool decision say what survives, where selection lands,
      // and whether to respawn — the same module both close paths route through,
      // so the never-empty invariant and the sibling-filtering live in one
      // tested place.
      const target: TabPoolTarget | null = chat?.branchId
        ? { kind: "agent", branchId: chat.branchId }
        : chat?.markdownLayerId
          ? { kind: "doc", markdownLayerId: chat.markdownLayerId }
          : null
      updateChatSession(chatId, { closedAt: Date.now() })
      if (!target) return
      const pool = buildTabPool(target, chatSessions, localTerminals)
      const outcome = resolveTabClose(pool, chatId, selectedChatId, nextSelectedId)
      applyTabCloseOutcome(outcome)
    },
    [
      selectedChatId,
      chatSessions,
      localTerminals,
      updateChatSession,
      isLocalTerminal,
      closeTerminal,
      applyTabCloseOutcome,
    ]
  )

  const reopen = useCallback(
    (chatId: string) => {
      updateChatSession(chatId, { closedAt: 0 })
      setSelectedChatId(chatId)
    },
    [updateChatSession, setSelectedChatId]
  )

  const remove = useCallback(
    (chatId: string) => {
      if (isLocalTerminal(chatId)) {
        closeTerminal(chatId)
        return
      }
      if (selectedChatId === chatId) {
        const chat = chatSessions.find((c) => c.id === chatId)
        if (chat) {
          const sameTarget = (c: ChatSessionData) =>
            chat.branchId
              ? c.branchId === chat.branchId
              : chat.markdownLayerId
                ? c.markdownLayerId === chat.markdownLayerId
                : false
          const siblings = chatSessions
            .filter((c) => sameTarget(c) && c.id !== chatId && !c.closedAt)
            .sort((a, b) => a.createdAt - b.createdAt)
          setSelectedChatId(siblings[0]?.id ?? null)
        } else {
          setSelectedChatId(null)
        }
      }
      chatStore.cleanup(chatId)
      removeChatSession(chatId)
    },
    [
      selectedChatId,
      chatSessions,
      removeChatSession,
      isLocalTerminal,
      closeTerminal,
      setSelectedChatId,
    ]
  )

  const rename = useCallback(
    (chatId: string, label: string) => {
      if (isLocalTerminal(chatId)) {
        setLocalTerminals((prev) =>
          prev.map((t) => (t.id === chatId ? { ...t, label } : t))
        )
        return
      }
      updateChatSession(chatId, { label })
    },
    [updateChatSession, isLocalTerminal, setLocalTerminals]
  )

  const select = useCallback(
    (chatId: string | null) => {
      setSelectedChatId(chatId)
      if (chatId) {
        const terminal = localTerminals.find((t) => t.id === chatId)
        if (terminal) {
          // Local terminals aren't in the Y.Doc; just track their branch so
          // the agent target stays selected. No per-target "remember" ref —
          // they don't survive a remount anyway.
          if (terminal.branchId) setSelectedAgentId(terminal.branchId)
          return
        }
        const chat = chatSessions.find((c) => c.id === chatId)
        if (!chat) return
        if (chat.branchId) {
          setSelectedAgentId(chat.branchId)
          selectedChatByAgentRef.current[chat.branchId] = chatId
        }
        if (chat.markdownLayerId) {
          setSelectedDocumentChatTargetId(chat.markdownLayerId)
          selectedChatByDocumentRef.current[chat.markdownLayerId] = chatId
        }
      }
    },
    [
      chatSessions,
      localTerminals,
      setSelectedChatId,
      setSelectedAgentId,
      setSelectedDocumentChatTargetId,
      selectedChatByAgentRef,
      selectedChatByDocumentRef,
    ]
  )

  return { open, close, remove, select, rename, reopen, seed }
}
