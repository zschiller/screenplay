/**
 * Canvas Selection — the React-free, Yjs-free decision core for what is
 * selected on the canvas and what happens to the selection on delete.
 *
 * Selection on the canvas is three coordinated Sets — selected Iframe Layers,
 * selected Groups, and selected Markdown Layers — kept apart so a member is
 * never represented twice (a Group owns its members; selecting the Group
 * supersedes its children). The rules that keep them coordinated were
 * copy-pasted across the canvas component's many call sites; this module is the
 * single home for the ones that carry real logic:
 *
 *  - **cascade** a selected Group down to its Members across both kinds
 *    ({@link expandSelectedGroups}),
 *  - decide **what gets deleted and what is selected next**
 *    ({@link resolveSelectionDelete} and {@link nextIframeLayerAfterDelete}),
 *  - the **shift-toggle** rule ({@link toggleSelection}),
 *  - and the derived **projections** the overlay and sidebar read
 *    ({@link overlaySelectedIds}, {@link groupSelectedMemberIds}).
 *
 * Pure functions of plain snapshots (selection Sets + group member lists), so
 * they are pinned by fixtures against plain values — the controller
 * (`useCanvasSelection`) is the thin apply-side that owns the React state and
 * applies removals through the Canvas Operations seam.
 */

/** The two layer kinds a Group's Member can reference. */
export type SelectionKind = "iframe-layer" | "markdown-layer"

/** A plain snapshot of the three selection Sets. */
export interface SelectionSnapshot {
  iframeLayerIds: ReadonlySet<string>
  groupIds: ReadonlySet<string>
  markdownLayerIds: ReadonlySet<string>
}

/** The slice of a Group the selection decisions read: its id and its Members. */
export interface SelectionGroupSnapshot {
  id: string
  members: ReadonlyArray<{ kind: SelectionKind; id: string }>
}

/**
 * Expand the current selection's Groups down into their Members, unioned with
 * the directly-selected layers. Cascades across kinds: a selected Group
 * contributes every Iframe Layer *and* Markdown Layer it holds. The starting
 * direct selections are always included.
 */
export function expandSelectedGroups(
  selection: SelectionSnapshot,
  groups: readonly SelectionGroupSnapshot[]
): { iframeLayerIds: Set<string>; markdownLayerIds: Set<string> } {
  const iframeLayerIds = new Set<string>(selection.iframeLayerIds)
  const markdownLayerIds = new Set<string>(selection.markdownLayerIds)
  if (selection.groupIds.size > 0) {
    for (const g of groups) {
      if (!selection.groupIds.has(g.id)) continue
      for (const m of g.members) {
        if (m.kind === "iframe-layer") iframeLayerIds.add(m.id)
        else if (m.kind === "markdown-layer") markdownLayerIds.add(m.id)
      }
    }
  }
  return { iframeLayerIds, markdownLayerIds }
}

/**
 * After a single Iframe Layer is removed, the layer to select next: prefer the
 * right-hand Iframe Layer neighbor in its Group's row, falling back to the
 * left. Skips Markdown members so the next selection is always a frame. Returns
 * `null` when the layer has no Iframe Layer neighbor (or isn't found).
 */
export function nextIframeLayerAfterDelete(
  deletedId: string,
  groups: readonly SelectionGroupSnapshot[]
): string | null {
  for (const g of groups) {
    const ids = g.members
      .filter((m) => m.kind === "iframe-layer")
      .map((m) => m.id)
    const idx = ids.indexOf(deletedId)
    if (idx === -1) continue
    return ids[idx + 1] ?? ids[idx - 1] ?? null
  }
  return null
}

/** What a delete resolves to: the layers to remove and the next selection. */
export interface SelectionDeleteResult {
  /** Iframe Layer ids to remove (selected frames + cascaded Group members). */
  removeIframeLayerIds: string[]
  /** Markdown Layer ids to remove (selected docs + cascaded Group members). */
  removeMarkdownLayerIds: string[]
  /** The selection to apply after the removal lands. */
  nextSelection: SelectionSnapshot
  /** Whether anything is selected to delete at all. */
  hasRemovals: boolean
}

/**
 * Resolve a Delete/Backspace over the current selection: cascade selected
 * Groups to their Members, decide the ids to remove, and compute the next
 * selection. A single Iframe Layer delete keeps selection on the right (else
 * left) neighbor; any multi-selection delete clears. Groups clear once any
 * Iframe Layer removal happens; the Markdown selection clears once any Markdown
 * removal happens. Selections of an untouched kind are left in place.
 */
export function resolveSelectionDelete(
  selection: SelectionSnapshot,
  groups: readonly SelectionGroupSnapshot[]
): SelectionDeleteResult {
  const { iframeLayerIds: allIframe, markdownLayerIds: allDoc } =
    expandSelectedGroups(selection, groups)

  // Default: nothing changes (the no-removal case).
  let nextIframe: Set<string> = new Set(selection.iframeLayerIds)
  let nextGroup: Set<string> = new Set(selection.groupIds)
  let nextDoc: Set<string> = new Set(selection.markdownLayerIds)

  const removeIframeLayerIds: string[] = []
  const removeMarkdownLayerIds: string[] = []

  if (allIframe.size > 0) {
    // Single-frame delete: keep selection on a neighbor. Multi-frame (or mixed
    // with docs) deletes clear — no obvious "next" candidate.
    let nextSelected: string | null = null
    if (allIframe.size === 1 && allDoc.size === 0) {
      const onlyId = allIframe.values().next().value as string
      nextSelected = nextIframeLayerAfterDelete(onlyId, groups)
    }
    removeIframeLayerIds.push(...allIframe)
    nextIframe = nextSelected ? new Set([nextSelected]) : new Set()
    nextGroup = new Set()
  }

  if (allDoc.size > 0) {
    removeMarkdownLayerIds.push(...allDoc)
    nextDoc = new Set()
  }

  return {
    removeIframeLayerIds,
    removeMarkdownLayerIds,
    nextSelection: {
      iframeLayerIds: nextIframe,
      groupIds: nextGroup,
      markdownLayerIds: nextDoc,
    },
    hasRemovals:
      removeIframeLayerIds.length > 0 || removeMarkdownLayerIds.length > 0,
  }
}

/**
 * Shift-toggle a single id within a Set: returns a new Set with the id removed
 * if present, added if absent. The base rule behind shift-click extending a
 * frame or document selection.
 */
export function toggleSelection(
  set: ReadonlySet<string>,
  id: string
): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Projection: the union of selected Iframe Layer and Markdown Layer ids. The
 * SelectionOverlay treats every member id uniformly (it looks them up against
 * the shared layout map), so it reads this single merged Set.
 */
export function overlaySelectedIds(selection: SelectionSnapshot): Set<string> {
  const ids = new Set<string>(selection.iframeLayerIds)
  for (const id of selection.markdownLayerIds) ids.add(id)
  return ids
}

/**
 * Projection: every Member id (both kinds) belonging to a currently-selected
 * Group. Drives the group-selection highlight on each member's name/label so a
 * doc participates in Group selection the same way a frame does.
 */
export function groupSelectedMemberIds(
  selection: SelectionSnapshot,
  groups: readonly SelectionGroupSnapshot[]
): Set<string> {
  const ids = new Set<string>()
  if (selection.groupIds.size === 0) return ids
  for (const g of groups) {
    if (!selection.groupIds.has(g.id)) continue
    for (const m of g.members) ids.add(m.id)
  }
  return ids
}
