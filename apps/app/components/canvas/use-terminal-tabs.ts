import { useCallback, useEffect, useMemo, useState } from "react"
import { nanoid } from "nanoid"

import { createTerminalTab, nextShellLabel } from "@/lib/canvas/tab-kind"
import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import { partitionTerminalsByBranch } from "@/lib/terminal/orphan-tabs"
import {
  mergeRestoredTabs,
  terminalTabsFromRecords,
} from "@/lib/terminal/restore-tabs"
import type { TerminalTabStore } from "@/lib/terminal/tab-store"
import type { BranchData, TerminalTabData } from "@/lib/types"

/**
 * Terminal Tabs (#1265) — the one owner of this client's Terminal Tab list and
 * the only code that changes it, through the verbs below: `open`, `close`,
 * `rename`, and the two it runs on its own, **restore** (first-paint seed from
 * the server-fetched rows, then a re-fetch-and-merge) and **prune** (drop a tab
 * whose Branch is gone). The Tab Pool composes it for the pool decisions but
 * never sets the list itself.
 *
 * What close and prune guarantee — the same for both: the tab leaves the strip,
 * its row is deleted (so it never comes back on reload), and its session is
 * killed (so the shell and whatever runs in it stop). Prune kills with no
 * Sandbox name, since the Branch's Sandbox is gone with it: the hosted tmux
 * session died with that Sandbox, and the desktop PTY is killed in the sidecar.
 *
 * The row and the session sit behind one {@link TerminalTabStore}: the server
 * actions in production, in memory in tests. Every store call is best-effort
 * and optimistic — the list changes first, a failed call is logged.
 *
 * Terminal tabs are deliberately kept out of the shared `chatSessions` Y.Doc
 * collection: they're per-user shells that must never appear in
 * collaborators' tab strips or enter the conversation model. Only the tab
 * identity is stored, never scrollback. Co-view across clients is still a
 * deliberate non-goal — see ADR 0002 / follow-up.
 */
export interface TerminalTabsDeps {
  roomId: string
  /** Live branches — the prune drops a tab whose Branch is gone. */
  agents: BranchData[]
  /** Server-fetched rows (page.tsx) for the first-paint seed. */
  initialTerminalTabs?: TerminalTabRecord[]
  store: TerminalTabStore
}

export interface TerminalTabs {
  tabs: TerminalTabData[]
  /** True when `id` names one of this client's Terminal Tabs (never a chat). */
  isTerminal: (id: string | null) => boolean
  /**
   * Open a plain shell on a Branch (#1343), named "Shell", "Shell 2"…, and
   * save its row.
   */
  open: (branchId: string) => TerminalTabData
  /**
   * Close a tab: drop it, delete its row, kill its session. Returns the tab as
   * it was, or `undefined` when `id` isn't open.
   */
  close: (id: string) => TerminalTabData | undefined
  /** Rename a tab on this client. */
  rename: (id: string, label: string) => void
}

function logFailure(what: string) {
  return (err: unknown) => console.error(`Failed to ${what}`, err)
}

export function useTerminalTabs(deps: TerminalTabsDeps): TerminalTabs {
  const { roomId, agents, initialTerminalTabs, store } = deps

  // Seed from the server-fetched tabs (page.tsx) so restored terminals are on
  // the very first client paint — same as chats (which arrive in the synced
  // Y.Doc). Without this seed they'd pop in a beat late, after the client-side
  // `store.list` round-trip below resolves.
  const [tabs, setTabs] = useState<TerminalTabData[]>(() =>
    terminalTabsFromRecords(initialTerminalTabs ?? [])
  )
  const isTerminal = useCallback(
    (id: string | null) => !!id && tabs.some((t) => t.id === id),
    [tabs]
  )

  const open = useCallback(
    (branchId: string) => {
      // The tab id doubles as the live-view `terminalSessionId`. No harness:
      // shells are plain shells, and harnesses run as the chat (#1343).
      const tab = createTerminalTab({
        id: nanoid(),
        branchId,
        createdAt: Date.now(),
        label: nextShellLabel(
          tabs.filter((t) => t.branchId === branchId).map((t) => t.label)
        ),
      })
      setTabs((prev) => [...prev, tab])
      store.save(roomId, tab).catch(logFailure("persist terminal tab"))
      return tab
    },
    [tabs, roomId, store]
  )

  const close = useCallback(
    (id: string) => {
      const closing = tabs.find((t) => t.id === id)
      setTabs((prev) => prev.filter((t) => t.id !== id))
      // Closing deletes the row (a reload alone never does)…
      store.delete(roomId, id).catch(logFailure("delete terminal tab"))
      // …and kills the session so the shell and any harness in it stop, not
      // just the tab UI. Separate from the row delete so a down sandbox can't
      // keep the tab around.
      if (closing) {
        const sandboxName =
          agents.find((a) => a.id === closing.branchId)?.sandboxName || null
        store
          .killSession(roomId, {
            terminalSessionId: closing.terminalSessionId,
            sandboxName,
          })
          .catch(logFailure("kill terminal session"))
      }
      return closing
    },
    [tabs, roomId, agents, store]
  )

  const rename = useCallback((id: string, label: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)))
  }, [])

  // Restore: re-fetch this User's saved tabs for the room (#258). Keeps the
  // seeded set fresh on client-side Branch/room navigation (when the component
  // doesn't remount, so the seed above is stale) and reconciles tabs opened on
  // another device. Merge rather than replace (`mergeRestoredTabs`), so a tab
  // the user opened before this resolved isn't dropped.
  useEffect(() => {
    let cancelled = false
    store
      .list(roomId)
      .then((rows) => {
        if (cancelled) return
        const restored = terminalTabsFromRecords(rows)
        setTabs((prev) => mergeRestoredTabs(restored, prev))
      })
      .catch(logFailure("restore terminal tabs"))
    return () => {
      cancelled = true
    }
  }, [roomId, store])

  // Prune: drop tabs whose Branch no longer exists, so a dead terminal never
  // lingers pointing at a gone sandbox (#260). We get here only post-sync
  // (render is gated on the Yjs initial sync), so an absent branch is a
  // genuinely deleted one — not an unhydrated collection — making it safe to
  // delete the row and kill the session, as close does. Depends on `tabs` too
  // so a row restored for an already-deleted branch is pruned on load. The
  // state update reconciles React state with externally-sourced data (restored
  // rows vs. live branches), a legitimate effect sync.
  useEffect(() => {
    const branchIds = new Set(agents.map((a) => a.id))
    const { orphaned } = partitionTerminalsByBranch(tabs, branchIds)
    if (orphaned.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabs((prev) => prev.filter((t) => branchIds.has(t.branchId)))
    // Both calls are idempotent, so a re-run before they land is harmless.
    for (const orphan of orphaned) {
      store
        .delete(roomId, orphan.id)
        .catch(logFailure("prune orphaned terminal tab"))
      store
        .killSession(roomId, {
          terminalSessionId: orphan.terminalSessionId,
          sandboxName: null,
        })
        .catch(logFailure("kill orphaned terminal session"))
    }
  }, [agents, tabs, roomId, store])

  return useMemo(
    () => ({ tabs, isTerminal, open, close, rename }),
    [tabs, isTerminal, open, close, rename]
  )
}
