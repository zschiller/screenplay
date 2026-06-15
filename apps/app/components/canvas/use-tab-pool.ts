import { useCallback } from "react"
import { nanoid } from "nanoid"

import { chatStore } from "@/lib/chat-store"
import {
  buildTabPool,
  resolveTabClose,
  type TabCloseOutcome,
  type TabPoolTarget,
} from "@/lib/chat/tab-pool"
import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { TerminalTabs } from "@/components/canvas/use-terminal-tabs"
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
import type { BranchData, ChatSessionData, TabKind } from "@/lib/types"

/**
 * Tab Pool controller (PRD #563) — the apply-side of a Chat Target's tab pool,
 * lifted out of `components/canvas/canvas.tsx`. The component renders the tab
 * strip and calls the verbs this hook returns (`open`, `close`, `remove`,
 * `rename`, `reopen`, `seed`); the effects — the chat-store and Y.Doc tab
 * writes, the Terminal Tab server actions, and the tmux / PTY teardown — live
 * here, in one place, rather than smeared across the Canvas surface. The
 * selection side effects each verb performs are delegated to the Chat-Target
 * controller (`useChatTarget`, #569), which owns *which* target is shown;
 * selecting a tab itself is now a Chat-Target verb (`selectChat`).
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
  /**
   * The Terminal Tab controller (#582) — owns this client's `localTerminals`
   * plus their seed / re-fetch-merge / orphan-prune lifecycle. The Tab Pool
   * composes it for the apply-side reads and writes (`localTerminals`,
   * `setLocalTerminals`, `isLocalTerminal`), the same way it composes
   * Chat-Target for selection, so the Terminal Tab apply-side and lifecycle
   * share one ownership chain. Terminal Tabs are a distinct type, never in
   * `chatSessions`.
   */
  terminalTabs: TerminalTabs
  /**
   * The Chat-Target controller (#569). The Tab Pool composes with it for the
   * selection side effects it used to perform by poking raw setters and memory
   * refs: it reads the current `selectedChatId` and calls the chat-target verbs
   * (`selectChatId`, `selectAgentChat`, `selectDocChat`) to move selection.
   */
  chatTarget: ChatTarget
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
    terminalTabs,
    chatTarget,
  } = deps
  const { localTerminals, setLocalTerminals, isLocalTerminal } = terminalTabs

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
        if (select) chatTarget.selectChatId(tab.id)
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
      if (select) chatTarget.selectChatId(id)
      return id
    },
    [roomId, addChatSession, userId, setLocalTerminals, chatTarget]
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
          chatTarget.selectDocChat(respawn.markdownLayerId, newId)
        }
        return
      }
      if (nextSelectedId !== undefined) chatTarget.selectChatId(nextSelectedId)
    },
    [seed, addChatSession, chatTarget]
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
        const outcome = resolveTabClose(
          pool,
          id,
          chatTarget.selectedChatId,
          nextSelectedId
        )
        applyTabCloseOutcome(outcome)
      } else if (chatTarget.selectedChatId === id) {
        // No branch to form a pool around (e.g. the row is already gone); just
        // clear the selection if it was the selected tab.
        chatTarget.selectChatId(nextSelectedId ?? null)
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
      chatTarget,
      chatSessions,
      localTerminals,
      roomId,
      agents,
      setLocalTerminals,
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
        chatTarget.selectAgentChat(spec.branchId, id)
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
        chatTarget.selectAgentChat(spec.branchId, id)
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
      chatTarget.selectDocChat(spec.markdownLayerId, id)
    },
    [addChatSession, roomId, setLocalTerminals, chatTarget]
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
      const outcome = resolveTabClose(
        pool,
        chatId,
        chatTarget.selectedChatId,
        nextSelectedId
      )
      applyTabCloseOutcome(outcome)
    },
    [
      chatTarget,
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
      chatTarget.selectChatId(chatId)
    },
    [updateChatSession, chatTarget]
  )

  const remove = useCallback(
    (chatId: string) => {
      if (isLocalTerminal(chatId)) {
        closeTerminal(chatId)
        return
      }
      if (chatTarget.selectedChatId === chatId) {
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
          chatTarget.selectChatId(siblings[0]?.id ?? null)
        } else {
          chatTarget.selectChatId(null)
        }
      }
      chatStore.cleanup(chatId)
      removeChatSession(chatId)
    },
    [
      chatTarget,
      chatSessions,
      removeChatSession,
      isLocalTerminal,
      closeTerminal,
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

  return { open, close, remove, rename, reopen, seed }
}
