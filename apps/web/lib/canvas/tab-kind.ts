import type { TabKind, TerminalTabData } from "@/lib/types"

/** Default label for a freshly-created terminal tab. */
export const TERMINAL_TAB_LABEL = "Terminal"

// Per-user pref for the default tab kind. It backs both the sticky "+" new-tab
// button (which repeats whichever kind was created last) and the auto-created
// default tab when a branch opens fresh or its last tab is closed — so all
// three honour one choice. Stored in localStorage so it survives reloads;
// mirrors the `agent-last-model` pref. Defaults to "chat".
const LAST_TAB_KIND_STORAGE_KEY = "agent-last-tab-kind"

export function readLastTabKind(): TabKind {
  if (typeof window === "undefined") return "chat"
  try {
    return window.localStorage.getItem(LAST_TAB_KIND_STORAGE_KEY) === "terminal"
      ? "terminal"
      : "chat"
  } catch {
    return "chat"
  }
}

export function writeLastTabKind(kind: TabKind) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LAST_TAB_KIND_STORAGE_KEY, kind)
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
}): TerminalTabData {
  return {
    id: input.id,
    branchId: input.branchId,
    terminalSessionId: input.id,
    label: input.label ?? TERMINAL_TAB_LABEL,
    createdAt: input.createdAt,
  }
}
