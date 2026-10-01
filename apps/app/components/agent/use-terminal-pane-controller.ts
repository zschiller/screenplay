"use client"

import { useCallback, useMemo, useState, useSyncExternalStore } from "react"

import {
  DEFAULT_TERMINAL_PANE_PREF,
  paneCloseFallback,
  paneTerminals,
  parseTerminalPanePref,
  resolvePaneSelection,
  type PaneTerminal,
  type TerminalPanePref,
} from "@/lib/chat/terminal-pane"
import type { TerminalTabData } from "@/lib/types"

/**
 * The per-person Terminal Pane pref (open, height), kept in localStorage under
 * the User's id so it's the same in every Workspace and survives a reload, and
 * read through one tiny store so every mounted pane follows a write at once.
 */
const STORAGE_PREFIX = "terminal-pane"
const listeners = new Set<() => void>()
// Parsed snapshots by their raw string, so `useSyncExternalStore` sees the same
// object until the stored value actually changes.
const snapshots = new Map<string, TerminalPanePref>()

function storageKey(userKey: string) {
  return `${STORAGE_PREFIX}:${userKey}`
}

function readPref(userKey: string): TerminalPanePref {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(storageKey(userKey))
  } catch {}
  if (raw === null) return DEFAULT_TERMINAL_PANE_PREF
  let pref = snapshots.get(raw)
  if (!pref) {
    pref = parseTerminalPanePref(raw)
    snapshots.set(raw, pref)
  }
  return pref
}

function writePref(userKey: string, patch: Partial<TerminalPanePref>) {
  const prev = readPref(userKey)
  const next = { ...prev, ...patch }
  if (next.open === prev.open && next.size === prev.size) return
  try {
    window.localStorage.setItem(storageKey(userKey), JSON.stringify(next))
  } catch {}
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface TerminalPaneController {
  /** Dev server first, then this person's shells on the Workspace. */
  terminals: PaneTerminal[]
  /** The terminal the pane shows; Dev server unless a shell is picked. */
  selectedId: string
  open: boolean
  /** The pane's height, as a percentage of the panel under the header. */
  size: number
  /** Open the pane on a terminal (a footnote name, Open logs, a new shell). */
  openOn: (terminalId: string) => void
  /** Show a terminal without changing whether the pane is open. */
  select: (terminalId: string) => void
  /** Open or close the pane (⌃`, the hide caret, the divider). */
  setOpen: (open: boolean) => void
  toggle: () => void
  /** Remember the height the person dragged the pane to. */
  setSize: (size: number) => void
  /** Move selection off a shell that's closing: its neighbour, else Dev server. */
  shellClosing: (terminalId: string) => void
}

/**
 * Terminal Pane controller (#1341, spec #1340) — the apply side of the pane
 * under a Workspace's chat. The pure rules (the order, the fallback on close,
 * the stored pref's shape) live in `lib/chat/terminal-pane.ts`; this hook holds
 * the state they act on: the per-person open/height pref, and which terminal
 * each Workspace's pane is showing (kept for the session, per Workspace, so
 * switching back lands where you left it).
 */
export function useTerminalPaneController({
  userId,
  branchId,
  shells,
}: {
  userId: string | undefined
  branchId: string
  /** This person's Terminal Tabs (any Workspace; filtered here). */
  shells: readonly TerminalTabData[]
}): TerminalPaneController {
  const userKey = userId ?? "anonymous"
  const pref = useSyncExternalStore(
    subscribe,
    () => readPref(userKey),
    () => DEFAULT_TERMINAL_PANE_PREF
  )
  const [selectedByBranch, setSelectedByBranch] = useState<
    Record<string, string>
  >({})

  const terminals = useMemo(
    () => paneTerminals(shells, branchId),
    [shells, branchId]
  )
  const selectedId = resolvePaneSelection(terminals, selectedByBranch[branchId])

  const select = useCallback(
    (terminalId: string) =>
      setSelectedByBranch((prev) =>
        prev[branchId] === terminalId
          ? prev
          : { ...prev, [branchId]: terminalId }
      ),
    [branchId]
  )
  const setOpen = useCallback(
    (open: boolean) => writePref(userKey, { open }),
    [userKey]
  )
  const toggle = useCallback(
    () => writePref(userKey, { open: !readPref(userKey).open }),
    [userKey]
  )
  const setSize = useCallback(
    (size: number) => writePref(userKey, { size }),
    [userKey]
  )
  const openOn = useCallback(
    (terminalId: string) => {
      select(terminalId)
      setOpen(true)
    },
    [select, setOpen]
  )
  const shellClosing = useCallback(
    (terminalId: string) => {
      if (selectedId !== terminalId) return
      select(paneCloseFallback(terminals, terminalId))
    },
    [selectedId, terminals, select]
  )

  return {
    terminals,
    selectedId,
    open: pref.open,
    size: pref.size,
    openOn,
    select,
    setOpen,
    toggle,
    setSize,
    shellClosing,
  }
}
