import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react"

import {
  deleteTerminalTabAction,
  listTerminalTabsAction,
} from "@/lib/terminal-tabs-actions"
import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import { partitionTerminalsByBranch } from "@/lib/terminal/orphan-tabs"
import {
  mergeRestoredTabs,
  terminalTabsFromRecords,
} from "@/lib/terminal/restore-tabs"
import type { BranchData, TerminalTabData } from "@/lib/types"

/**
 * Terminal Tab controller (PRD #579, cut 3/4) — the lifecycle of this client's
 * Terminal Tabs, lifted out of `components/canvas/canvas.tsx`. It owns the
 * `localTerminals` state, the first-paint seed from the server-fetched rows, the
 * client-side re-fetch-and-merge, and the orphan prune; the Tab Pool controller
 * composes it (the way it already composes Chat-Target) so the Terminal Tab
 * apply-side and lifecycle share one ownership chain instead of being split
 * between the root and the Tab Pool.
 *
 * Terminal tabs are deliberately kept out of the shared `chatSessions` Y.Doc
 * collection: they're per-user, BYO-harness shells that must never appear in
 * collaborators' tab strips or enter the conversation model. They live in this
 * client's state, but their identity/metadata is persisted per user+room+branch
 * in Postgres (#258, the `terminalTab` table) — so a reload restores them and
 * they follow the User across devices. Only the tab identity is stored, never
 * scrollback. Co-view across clients is still a deliberate non-goal — see
 * ADR 0002 / follow-up.
 *
 * The seed/merge reconciliation is a pure function (`lib/terminal/restore-tabs`)
 * and the orphan partition is `lib/terminal/orphan-tabs`; this controller is the
 * React binding that applies them.
 */
export interface TerminalTabsDeps {
  roomId: string
  /** Live branches — the orphan prune drops a tab whose Branch is gone. */
  agents: BranchData[]
  /** Server-fetched rows (page.tsx) for the first-paint seed. */
  initialTerminalTabs?: TerminalTabRecord[]
}

export interface TerminalTabs {
  localTerminals: TerminalTabData[]
  setLocalTerminals: Dispatch<SetStateAction<TerminalTabData[]>>
  /** True when `id` names one of this client's Terminal Tabs (never a chat). */
  isLocalTerminal: (id: string | null) => boolean
}

export function useTerminalTabs(deps: TerminalTabsDeps): TerminalTabs {
  const { roomId, agents, initialTerminalTabs } = deps

  // Seed from the server-fetched tabs (page.tsx) so restored terminals are on
  // the very first client paint — same as chats (which arrive in the synced
  // Y.Doc). Without this seed they'd pop in a beat late, after the client-side
  // `listTerminalTabsAction` round-trip below resolves.
  const [localTerminals, setLocalTerminals] = useState<TerminalTabData[]>(() =>
    terminalTabsFromRecords(initialTerminalTabs ?? [])
  )

  const isLocalTerminal = useCallback(
    (id: string | null) => !!id && localTerminals.some((t) => t.id === id),
    [localTerminals]
  )

  // Re-fetch this User's persisted terminal tabs for the room (#258): keeps the
  // seeded set fresh on client-side Branch/room navigation (when the component
  // doesn't remount, so the seed above is stale) and reconciles tabs opened on
  // another device. Merge rather than replace (`mergeRestoredTabs`), so a tab
  // the user opened before this resolved isn't dropped.
  useEffect(() => {
    let cancelled = false
    listTerminalTabsAction({ roomId })
      .then((rows) => {
        if (cancelled) return
        const restored = terminalTabsFromRecords(rows)
        setLocalTerminals((prev) => mergeRestoredTabs(restored, prev))
      })
      .catch((err) => {
        console.error("Failed to restore terminal tabs", err)
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  // Lazily prune terminal tabs whose Branch no longer exists (branch deleted),
  // so a dead terminal never lingers pointing at a gone sandbox (#260). We get
  // here only post-sync (render is gated on the Yjs initial sync), so an absent
  // branch is a genuinely deleted one — not an unhydrated collection — making it
  // safe to also delete the persisted row, not just drop the tab from the strip.
  // Depends on `localTerminals` too so a row restored from Postgres for an
  // already-deleted branch is pruned on connect/load, with no background job.
  // The state update here reconciles React state with externally-sourced data
  // (Postgres-restored terminal rows vs. live branches), which is a legitimate
  // effect sync rather than an avoidable render cascade.
  useEffect(() => {
    const branchIds = new Set(agents.map((a) => a.id))
    const { orphaned } = partitionTerminalsByBranch(localTerminals, branchIds)
    if (orphaned.length === 0) return
    // Drop the orphans from the tab strip…
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalTerminals((prev) => prev.filter((t) => branchIds.has(t.branchId)))
    // …and delete their `terminalTab` rows so they don't resurrect next load.
    // Best-effort + idempotent: deleting an already-gone row is a no-op.
    for (const orphan of orphaned) {
      deleteTerminalTabAction({ roomId, id: orphan.id }).catch((err) => {
        console.error("Failed to prune orphaned terminal tab", err)
      })
    }
  }, [agents, localTerminals, roomId])

  return { localTerminals, setLocalTerminals, isLocalTerminal }
}
