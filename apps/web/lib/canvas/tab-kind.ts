import type { TabKind, TerminalTabData } from "@/lib/types"

/** Default label for a freshly-created terminal tab. */
export const TERMINAL_TAB_LABEL = "Terminal"

/**
 * The harness a new terminal tab launches into. The launch-side tracer bullet
 * (#285): one harness, no picker yet — the "+" button always opens Claude Code.
 * Stored on the tab (by key, not argv) and resolved server-side to a launch
 * command at connect time; falls back to a plain shell if the key isn't
 * installed in the sandbox.
 */
export const DEFAULT_HARNESS_KEY = "claude-code"

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
  /**
   * Harness to launch into, passed through verbatim. A new tab from the "+"
   * button passes {@link DEFAULT_HARNESS_KEY}; restoring a persisted row passes
   * its stored key (omitted/undefined for a pre-#285 row, which opens a plain
   * shell). Deliberately *not* defaulted here, so restoration can't silently
   * upgrade an old plain-shell tab to a harness.
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
