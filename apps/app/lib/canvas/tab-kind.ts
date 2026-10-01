import type { TerminalTabData } from "@/lib/types"

/** Label for a new Terminal Tab: "Shell", then "Shell 2", "Shell 3"… */
export const TERMINAL_TAB_LABEL = "Shell"

/**
 * The label for a Workspace's next shell: "Shell" while no shell uses it,
 * else "Shell N" for the lowest free N from 2, so the footnote never lists
 * two shells under one name. Renamed shells don't take a number.
 */
export function nextShellLabel(labels: readonly string[]): string {
  const taken = new Set(labels)
  if (!taken.has(TERMINAL_TAB_LABEL)) return TERMINAL_TAB_LABEL
  let n = 2
  while (taken.has(`${TERMINAL_TAB_LABEL} ${n}`)) n++
  return `${TERMINAL_TAB_LABEL} ${n}`
}

// Per-target tab ordering. The tab strip is drag-reorderable (motion's
// `Reorder`), and the chosen order is a personal UI preference — it lives in
// localStorage rather than the shared room state so one operator's arrangement
// doesn't reorder another's tabs. Keyed by the chat target (an agent's id or a
// layer's id) so each branch/layer keeps its own arrangement. Stores just the
// ordered tab ids; ids no longer present are ignored on read, and tabs missing
// from the stored list fall back to their createdAt order, appended at the end.
const TAB_ORDER_STORAGE_PREFIX = "agent-tab-order"

function tabOrderStorageKey(targetKey: string): string {
  return `${TAB_ORDER_STORAGE_PREFIX}:${targetKey}`
}

export function readTabOrder(targetKey: string): string[] {
  if (typeof window === "undefined" || !targetKey) return []
  try {
    const raw = window.localStorage.getItem(tabOrderStorageKey(targetKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : []
  } catch {
    return []
  }
}

export function writeTabOrder(targetKey: string, ids: string[]) {
  if (typeof window === "undefined" || !targetKey) return
  try {
    window.localStorage.setItem(
      tabOrderStorageKey(targetKey),
      JSON.stringify(ids)
    )
  } catch {}
}

/**
 * Build the {@link TerminalTabData} for a new terminal tab against `branchId`'s
 * sandbox. The tab's own `id` doubles as its `terminalSessionId` — the shared
 * live-view key — so a second client opening the same tab co-views one PTY.
 *
 * A terminal tab is a distinct type from `ChatSessionData`, so it can never be
 * written into chat history, the Postgres conversation tables, or the
 * conversation Y.Doc.
 */
export function createTerminalTab(input: {
  id: string
  branchId: string
  createdAt: number
  label?: string
  /**
   * Harness the tab launches into. New tabs are plain shells and omit it
   * (#1343); only restoring a row saved when terminals could launch a harness
   * passes one, so that tab keeps running its CLI until it's closed.
   */
  harnessKey?: string
}): TerminalTabData {
  return {
    id: input.id,
    branchId: input.branchId,
    terminalSessionId: input.id,
    harnessKey: input.harnessKey,
    label: input.label ?? TERMINAL_TAB_LABEL,
    createdAt: input.createdAt,
  }
}
