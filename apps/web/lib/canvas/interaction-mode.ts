/**
 * Pure reconciler for the canvas's two interaction modes — Focus
 * ("interactive") mode and Create Flow ("flow") mode. Each mode is held as a
 * single IframeLayer id (or `null` when inactive) and the two are mutually
 * exclusive.
 *
 * When the frame backing an active mode is deleted, the canvas must drop out of
 * that mode so panning/zooming/scrolling resume immediately. Rather than patch
 * every delete call-site, the canvas reconciles its mode ids against the live
 * layer set: any id whose frame is gone becomes `null`.
 *
 * React-free and side-effect-free (per ADR 0001's seam principle), so it is
 * testable against plain data. The canvas component owns the `useState` values
 * and an effect that feeds them — plus the live id set — through this function.
 */
export function reconcileInteractionMode(input: {
  focusedId: string | null
  createFlowId: string | null
  existingLayerIds: ReadonlySet<string>
}): { focusedId: string | null; createFlowId: string | null } {
  const { focusedId, createFlowId, existingLayerIds } = input
  return {
    focusedId: clearIfMissing(focusedId, existingLayerIds),
    createFlowId: clearIfMissing(createFlowId, existingLayerIds),
  }
}

/**
 * Returns the id unchanged when it is `null` or still present in the live set;
 * otherwise `null`. Clearing only ever turns an id into `null`, so mutual
 * exclusion between the two modes is preserved trivially.
 */
function clearIfMissing(
  id: string | null,
  existingLayerIds: ReadonlySet<string>
): string | null {
  if (id === null) return null
  return existingLayerIds.has(id) ? id : null
}
