import type { IframeLayerData } from "@/lib/types"

/**
 * The pure eligibility seam for composer-driven element targeting (PRD #616,
 * slice #618). A composer can only target frames that belong to its own bound
 * Branch — cross-branch targeting is out of scope — so this returns exactly the
 * iframe layers whose `branchId` matches the composer's branch.
 *
 * Callers (the canvas pick orchestration) restrict the crosshair hit-test to
 * this set; the target-icon disabled/dimmed UX is a separate slice and is not
 * decided here. An absent or empty `composerBranchId` (a composer with no bound
 * Branch — e.g. the seed composer, which never targets) yields the empty set, as
 * does a frame with no `branchId` (an empty frame not yet associated with a
 * Branch): matching happens on a concrete id, never on `undefined === undefined`.
 */
export function eligibleTargetFrames(
  composerBranchId: string | undefined,
  iframeLayers: IframeLayerData[]
): IframeLayerData[] {
  if (!composerBranchId) return []
  return iframeLayers.filter((layer) => layer.branchId === composerBranchId)
}
