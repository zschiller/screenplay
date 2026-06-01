import type { TerminalTabData } from "@/lib/types"

/**
 * Split terminal tabs into those whose Branch still exists and those whose
 * Branch is gone (deleted out from under the tab). Pure — no DOM, no server
 * imports — so the canvas's lazy orphan-prune (#260) is unit-testable without
 * mounting the canvas: an orphaned tab is dropped from the tab strip *and* its
 * `terminalTab` row is deleted, so it never resurrects on the next load.
 *
 * `liveBranchIds` must be the *post-sync* branch set. The canvas only renders
 * (and thus only prunes) after the Yjs initial sync completes, so an absent
 * branch id means the Branch was genuinely deleted — not that the collection
 * simply hasn't hydrated yet.
 */
export function partitionTerminalsByBranch(
  terminals: readonly TerminalTabData[],
  liveBranchIds: ReadonlySet<string>,
): { kept: TerminalTabData[]; orphaned: TerminalTabData[] } {
  const kept: TerminalTabData[] = []
  const orphaned: TerminalTabData[] = []
  for (const tab of terminals) {
    if (liveBranchIds.has(tab.branchId)) kept.push(tab)
    else orphaned.push(tab)
  }
  return { kept, orphaned }
}
