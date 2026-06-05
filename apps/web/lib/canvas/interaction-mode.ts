/**
 * Pure reconciler for the canvas's two interaction modes — Focus
 * ("interactive") mode and Create Flow ("flow") mode. Each mode is held as a
 * single IframeLayer id (or `null` when inactive) and the two are mutually
 * exclusive.
 *
 * An active mode is dropped when the frame backing it is either deleted or
 * deselected — in both cases the frame stops being the user's active target, so
 * the canvas must leave the mode and let panning/zooming/scrolling resume. (A
 * mode is only ever entered from the frame's own toolbar, which requires the
 * frame to be selected, so "still selected" is the invariant that keeps it
 * alive.) Rather than patch every delete/deselect call-site, the canvas
 * reconciles its mode ids against the live layer set and the current selection:
 * any id whose frame is gone or no longer selected becomes `null`.
 *
 * React-free and side-effect-free (per ADR 0001's seam principle), so it is
 * testable against plain data. The canvas component owns the `useState` values
 * and an effect that feeds them — plus the live id set and selection — through
 * this function.
 */
export function reconcileInteractionMode(input: {
  focusedId: string | null
  createFlowId: string | null
  existingLayerIds: ReadonlySet<string>
  selectedLayerIds: ReadonlySet<string>
}): { focusedId: string | null; createFlowId: string | null } {
  const { focusedId, createFlowId, existingLayerIds, selectedLayerIds } = input
  return {
    focusedId: clearIfInactive(focusedId, existingLayerIds, selectedLayerIds),
    createFlowId: clearIfInactive(
      createFlowId,
      existingLayerIds,
      selectedLayerIds
    ),
  }
}

/**
 * Returns the id unchanged when it is `null`, or still both present in the live
 * set and selected; otherwise `null`. A deleted frame leaves the live set; a
 * deselected one leaves the selection — either drops the mode. Clearing only
 * ever turns an id into `null`, so mutual exclusion between the two modes is
 * preserved trivially.
 */
function clearIfInactive(
  id: string | null,
  existingLayerIds: ReadonlySet<string>,
  selectedLayerIds: ReadonlySet<string>
): string | null {
  if (id === null) return null
  if (!existingLayerIds.has(id)) return null
  if (!selectedLayerIds.has(id)) return null
  return id
}
