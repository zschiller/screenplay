import type { TerminalTabData } from "@/lib/types"

/**
 * Terminal Pane — the pure decisions behind the resizable pane under a
 * Workspace's chat (`apps/app/CONTEXT.md`, "Terminal Pane"; spec #1340). The
 * pane lists **Dev server** first, always, then the person's Terminal Tabs
 * (shells) in the order they were opened. Dev server can't be closed, so the
 * pane is never empty: closing a shell lands on its neighbour, which is Dev
 * server when nothing else is left. React-free and tested against plain values;
 * the Terminal Pane controller (`useTerminalPaneController`) applies them.
 */

/** The id Dev server goes by in the pane. Never a Terminal Tab's id (those are nanoids). */
export const DEV_SERVER_TERMINAL_ID = "dev-server"

/** What the pane calls the dev server's output. */
export const DEV_SERVER_LABEL = "Preview"

/** One terminal in the pane: Dev server, or one of the person's shells. */
export type PaneTerminal =
  | { kind: "dev-server"; id: typeof DEV_SERVER_TERMINAL_ID; label: string }
  | { kind: "shell"; id: string; label: string; terminal: TerminalTabData }

/** A Workspace's pane terminals: Dev server, then its shells oldest first. */
export function paneTerminals(
  terminals: readonly TerminalTabData[],
  branchId: string
): PaneTerminal[] {
  return [
    {
      kind: "dev-server",
      id: DEV_SERVER_TERMINAL_ID,
      label: DEV_SERVER_LABEL,
    },
    ...terminals
      .filter((t) => t.branchId === branchId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t): PaneTerminal => ({
        kind: "shell",
        id: t.id,
        label: t.label,
        terminal: t,
      })),
  ]
}

/**
 * The terminal the pane shows: the selected one while it's still there, else
 * Dev server (a shell closed on another device, or nothing picked yet).
 */
export function resolvePaneSelection(
  terminals: readonly PaneTerminal[],
  selectedId: string | null | undefined
): string {
  return selectedId && terminals.some((t) => t.id === selectedId)
    ? selectedId
    : DEV_SERVER_TERMINAL_ID
}

/**
 * Where selection lands when `closingId` closes: the tab after it, else the one
 * before it, which is Dev server when the closing shell was the only one. Dev
 * server itself never closes, so closing it decides nothing and keeps it.
 */
export function paneCloseFallback(
  terminals: readonly PaneTerminal[],
  closingId: string
): string {
  const index = terminals.findIndex((t) => t.id === closingId)
  if (index <= 0) return DEV_SERVER_TERMINAL_ID
  return (terminals[index + 1] ?? terminals[index - 1])!.id
}

/**
 * The pane's per-person layout: whether it's open and how tall it is, as a
 * percentage of the panel below the header. The same in every Workspace.
 */
export type TerminalPanePref = { open: boolean; size: number }

export const DEFAULT_TERMINAL_PANE_PREF: TerminalPanePref = {
  open: false,
  size: 40,
}

/** Bounds a stored height must fall in to be used (else the default). */
const MIN_SIZE = 10
const MAX_SIZE = 90

/** Parse a stored pref, falling back field by field on anything malformed. */
export function parseTerminalPanePref(
  raw: string | null | undefined
): TerminalPanePref {
  if (!raw) return DEFAULT_TERMINAL_PANE_PREF
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return DEFAULT_TERMINAL_PANE_PREF
    const { open, size } = parsed as Record<string, unknown>
    return {
      open: typeof open === "boolean" ? open : DEFAULT_TERMINAL_PANE_PREF.open,
      size:
        typeof size === "number" && size >= MIN_SIZE && size <= MAX_SIZE
          ? size
          : DEFAULT_TERMINAL_PANE_PREF.size,
    }
  } catch {
    return DEFAULT_TERMINAL_PANE_PREF
  }
}

/** Whether a keydown is the pane's toggle, ⌃` (Control and the backquote key). */
export function isTerminalPaneToggle(
  e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code">
): boolean {
  return (
    e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    e.code === "Backquote"
  )
}
