import { createTerminalTab } from "@/lib/canvas/tab-kind"
import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import type { TerminalTabData } from "@/lib/types"

/**
 * Map this User's persisted per-room terminal rows (#258, the `terminalTab`
 * table) to the client-local {@link TerminalTabData} the canvas renders. Pure —
 * no DOM, no server imports — so the Terminal Tab controller's first-paint seed
 * and its `listTerminalTabsAction` re-fetch share one conversion and the
 * reconciliation below is unit-testable without mounting the canvas.
 */
export function terminalTabsFromRecords(
  rows: readonly TerminalTabRecord[]
): TerminalTabData[] {
  return rows.map((r) =>
    createTerminalTab({
      id: r.id,
      branchId: r.branch,
      createdAt: r.createdAt,
      label: r.label,
      harnessKey: r.harnessKey ?? undefined,
    })
  )
}

/**
 * Reconcile the server-restored tabs against the tabs already open on this
 * client into one set — **merge, never replace**. The persisted rows come first
 * (so a restored, still-running shell is present on connect), then any local
 * tab the row set doesn't already carry. The local-only tail is what keeps a tab
 * the user opened *before* the `listTerminalTabsAction` round-trip resolved from
 * being dropped: it survives even though the server didn't know about it yet.
 *
 * A tab present in both (the common case on a plain reload — opened locally and
 * already persisted) appears once, from the restored set, so its persisted
 * metadata wins. Pure, so the no-drops / restored-first contract is pinned by a
 * test rather than implied by effect ordering.
 */
export function mergeRestoredTabs(
  restored: readonly TerminalTabData[],
  open: readonly TerminalTabData[]
): TerminalTabData[] {
  const restoredIds = new Set(restored.map((t) => t.id))
  const localOnly = open.filter((t) => !restoredIds.has(t.id))
  return [...restored, ...localOnly]
}
