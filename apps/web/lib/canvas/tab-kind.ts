import type { TerminalTabData } from "@/lib/types"

/** Default label for a freshly-created terminal tab. */
export const TERMINAL_TAB_LABEL = "Terminal"

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
