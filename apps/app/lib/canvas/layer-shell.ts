/**
 * The two pure decisions behind the Layer Shell's gesture wiring (see
 * `apps/app/CONTEXT.md`, "Layer Shell"). Both kinds of Layer (Iframe / Markdown)
 * route a press-drag and a press-release through the same two rules, so they
 * live here — React-free and side-effect-free — instead of being copy-pasted
 * into each content adapter. The Shell owns the refs and handlers; these
 * functions own only the branching.
 */

/**
 * Drag selection-routing predicate. A press-drag on a Layer (its body or its
 * group label) moves *something* — but what?
 *
 *  - When the Layer is itself selected, or its parent group is selected, the
 *    drag moves the whole current selection (so grabbing one selected group
 *    drags every selected group and loose Layer with it).
 *  - Otherwise it moves just this Layer's parent group.
 *
 * Returns `true` for "move the selection", `false` for "move the group".
 */
export function shouldMoveSelection(input: {
  selected: boolean
  groupSelected: boolean
}): boolean {
  return input.selected || input.groupSelected
}

/**
 * Deferred click-to-select decision, evaluated on the body overlay's
 * pointer-down. A plain press should select the Layer *before* a possible drag
 * begins (so the drag operates on the now-selected target), but it must not
 * steal selection from a selected parent group, and it must not re-fire when
 * the Layer is already the sole selection.
 *
 *  - While the parent group owns the selection, a plain press is a no-op —
 *    selection stays on the group so the drag moves the whole group; a
 *    shift-press still drills through to additively pick this member.
 *  - Otherwise select on press whenever the Layer isn't already selected, or
 *    the press is additive (shift), which toggles it within the selection.
 *
 * Returns `true` when the press should select now (and mark the pending click
 * as already-consumed), `false` to leave selection untouched.
 */
export function shouldSelectOnPointerDown(input: {
  selected: boolean
  groupSelected: boolean
  shiftKey: boolean
}): boolean {
  const { selected, groupSelected, shiftKey } = input
  if (groupSelected && !shiftKey) return false
  return !selected || shiftKey
}
