import type { TabKind, TerminalTabData } from "@/lib/types"

/** Default label for a freshly-created terminal tab. */
export const TERMINAL_TAB_LABEL = "Terminal"

/**
 * Fallback harness for a new terminal tab when the operator has no stored pick
 * yet and the installed-harness list isn't available to draw a default from
 * (still loading, or empty). The picker (#290) prefers the per-user
 * last-selected harness and otherwise the first installed harness; this constant
 * is only the last resort. Stored on the tab (by key, not argv) and resolved
 * server-side to a launch command at connect time; falls back to a plain shell
 * if the key isn't installed in the sandbox.
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

// Per-user "last-selected harness" pref backing the sticky "+" new-tab button
// and the harness picker menu (#290). Keyed per User so two operators sharing a
// browser profile don't inherit each other's pick. It is *only* a hint for what
// a fresh terminal tab should launch — never authoritative: a tab's harness
// lives on its `terminal_tab.harnessKey` row, so a stale local value can't
// retroactively change an existing tab's CLI (it's resolved from the row on
// reload, not from here). An unset/stale value falls back to a default from the
// installed list at the call site.
const LAST_HARNESS_KEY_STORAGE_PREFIX = "agent-last-harness-key"

function harnessStorageKey(userId: string): string {
  return `${LAST_HARNESS_KEY_STORAGE_PREFIX}:${userId}`
}

export function readLastHarnessKey(userId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(harnessStorageKey(userId))
  } catch {
    return null
  }
}

export function writeLastHarnessKey(userId: string, harnessKey: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(harnessStorageKey(userId), harnessKey)
  } catch {}
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
    window.localStorage.setItem(tabOrderStorageKey(targetKey), JSON.stringify(ids))
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
