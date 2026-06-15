import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getGroupMembers } from "@/lib/canvas/layout"
import {
  groupSelectedMemberIds,
  nextIframeLayerAfterDelete,
  overlaySelectedIds as overlaySelectedIdsPure,
  resolveSelectionDelete,
  toggleSelection,
  type SelectionGroupSnapshot,
  type SelectionKind,
  type SelectionSnapshot,
} from "@/lib/canvas/selection"
import type { IframeLayerGroupData } from "@/lib/types"

/**
 * Canvas Selection controller (PRD #567) — the apply-side of canvas selection,
 * lifted out of `components/canvas/canvas.tsx`. It owns the three selection
 * Sets (Iframe Layer / Group / Markdown Layer) and the internal mirror refs the
 * global keydown handler used to keep in sync by hand, and exposes a small verb
 * interface plus the derived projections the overlay and sidebar read.
 *
 * The decisions themselves stay in the React-free `lib/canvas/selection`
 * module: the cascade of a selected Group to its Members, the delete resolution
 * (next-neighbor / clear), the shift-toggle rule, and the overlay / group
 * projections. This controller is the thin adapter — "decide purely, apply at
 * the call site" — that owns the state, reads the latest group snapshot through
 * a ref so its verbs stay stable, and applies removals through the injected
 * Canvas Operations (`removeIframeLayers` / `removeDocumentLayers`), consistent
 * with how the gesture controller applies its Intents.
 *
 * The raw `set*` setters are also exposed for the call sites whose bespoke
 * selection combos (merge follow-on, pop-out, seed, draw-tool commit) haven't
 * been folded into named verbs yet — they live in the render tree the later
 * split will own. The logic-bearing rules are all here or in the pure module.
 */
export interface CanvasSelectionDeps {
  /** The live, synced Groups — read for cascade, projections, and neighbors. */
  groups: IframeLayerGroupData[]
  /** Remove Iframe Layers through the Canvas Operations seam. */
  removeIframeLayers: (ids: string[]) => void
  /** Remove Markdown Layers (and clean up their chats) through the seam. */
  removeDocumentLayers: (ids: string[]) => void
}

export interface CanvasSelection {
  // Live values (for render and memo dependencies).
  iframeLayerIds: Set<string>
  groupIds: Set<string>
  documentLayerIds: Set<string>

  // Derived projections (memoized).
  /** Union of selected Iframe + Markdown layer ids (the overlay reads this). */
  overlaySelectedIds: Set<string>
  /** Every member id (both kinds) of a selected Group. */
  groupSelectedIframeLayerIds: Set<string>

  /** Synchronous snapshot for the long-lived keydown / drag handlers. */
  current(): SelectionSnapshot

  // Verbs (the documented selection rules).
  /** Click / shift-click an Iframe Layer. */
  selectIframeLayer(id: string, shiftKey: boolean): void
  /** Click / shift-click a Group (shift drops members it now owns). */
  selectGroup(id: string, shiftKey: boolean): void
  /** Click / shift-click a Markdown Layer. */
  selectDocumentLayer(id: string, shiftKey: boolean): void
  /** A Member selected through the gesture path (no-move reorder release). */
  selectMember(memberId: string, kind: SelectionKind, additive: boolean): void
  /** Apply a marquee result (clears Group selection). */
  applyMarquee(
    iframeLayerIds: ReadonlySet<string>,
    documentLayerIds: ReadonlySet<string>
  ): void
  /** Clear all three selection Sets. */
  clear(): void
  /** Delete the current selection through `ops` and select what's next.
   *  Returns whether anything was deleted (so the keydown can preventDefault). */
  deleteSelected(): boolean
  /** Remove a single Iframe Layer (sidebar path) and select its neighbor. */
  removeIframeLayerAndReselect(id: string): void
  /** Drop a Group from the selection (e.g. after the Group is deleted). */
  removeGroupFromSelection(groupId: string): void

  // Raw setters for the not-yet-extracted render-tree call sites.
  setIframeLayerIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setGroupIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setDocumentLayerIds: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function useCanvasSelection(
  deps: CanvasSelectionDeps
): CanvasSelection {
  const { groups, removeIframeLayers, removeDocumentLayers } = deps

  const [iframeLayerIds, setIframeLayerIds] = useState<Set<string>>(new Set())
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set())
  const [documentLayerIds, setDocumentLayerIds] = useState<Set<string>>(
    new Set()
  )

  // Mirror refs so the verbs (and the keydown handler reading `current()`) see
  // the latest selection without re-binding. Written after commit, not during
  // render. Owning them here is the point of the controller: the keydown effect
  // stops maintaining its own shadow copy.
  const iframeLayerIdsRef = useRef(iframeLayerIds)
  const groupIdsRef = useRef(groupIds)
  const documentLayerIdsRef = useRef(documentLayerIds)
  useEffect(() => {
    iframeLayerIdsRef.current = iframeLayerIds
    groupIdsRef.current = groupIds
    documentLayerIdsRef.current = documentLayerIds
  })

  // Plain group member snapshots for the pure decisions, kept in a ref so the
  // verbs that read it (delete, shift-toggle guard, group member drop) stay
  // stable across group edits.
  const groupSnapshots = useMemo<SelectionGroupSnapshot[]>(
    () => groups.map((g) => ({ id: g.id, members: getGroupMembers(g) })),
    [groups]
  )
  const groupSnapshotsRef = useRef(groupSnapshots)
  useEffect(() => {
    groupSnapshotsRef.current = groupSnapshots
  })

  const current = useCallback(
    (): SelectionSnapshot => ({
      iframeLayerIds: iframeLayerIdsRef.current,
      groupIds: groupIdsRef.current,
      markdownLayerIds: documentLayerIdsRef.current,
    }),
    []
  )

  const findGroupIdForMember = useCallback(
    (memberId: string): string | undefined =>
      groupSnapshotsRef.current.find((g) =>
        g.members.some((m) => m.id === memberId)
      )?.id,
    []
  )

  const selectIframeLayer = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
        const parentGroupId = findGroupIdForMember(id)
        if (parentGroupId && groupIdsRef.current.has(parentGroupId)) return
        setIframeLayerIds((prev) => toggleSelection(prev, id))
      } else {
        setGroupIds(new Set())
        setIframeLayerIds(new Set([id]))
        setDocumentLayerIds(new Set())
      }
    },
    [findGroupIdForMember]
  )

  const selectDocumentLayer = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
        const parentGroupId = findGroupIdForMember(id)
        if (parentGroupId && groupIdsRef.current.has(parentGroupId)) return
        setDocumentLayerIds((prev) => toggleSelection(prev, id))
      } else {
        setGroupIds(new Set())
        setDocumentLayerIds(new Set([id]))
        setIframeLayerIds(new Set())
      }
    },
    [findGroupIdForMember]
  )

  const selectGroup = useCallback((groupId: string, shiftKey: boolean) => {
    if (shiftKey) {
      const group = groupSnapshotsRef.current.find((g) => g.id === groupId)
      const memberIds = new Set(group ? group.members.map((m) => m.id) : [])
      setGroupIds((prev) => toggleSelection(prev, groupId))
      // Taking the Group supersedes any of its members selected individually —
      // drop them so a member isn't represented twice.
      const dropMembers = (prev: Set<string>) => {
        if (![...memberIds].some((mid) => prev.has(mid))) return prev
        const next = new Set(prev)
        for (const mid of memberIds) next.delete(mid)
        return next
      }
      setIframeLayerIds(dropMembers)
      setDocumentLayerIds(dropMembers)
    } else {
      setIframeLayerIds(new Set())
      setDocumentLayerIds(new Set())
      setGroupIds(new Set([groupId]))
    }
  }, [])

  const selectMember = useCallback(
    (memberId: string, kind: SelectionKind, additive: boolean) => {
      setGroupIds(new Set())
      if (kind === "markdown-layer") {
        if (additive) {
          setDocumentLayerIds((prev) => toggleSelection(prev, memberId))
        } else {
          setDocumentLayerIds(new Set([memberId]))
          setIframeLayerIds(new Set())
        }
      } else {
        if (additive) {
          setIframeLayerIds((prev) => toggleSelection(prev, memberId))
        } else {
          setIframeLayerIds(new Set([memberId]))
          setDocumentLayerIds(new Set())
        }
      }
    },
    []
  )

  const applyMarquee = useCallback(
    (
      nextIframeLayerIds: ReadonlySet<string>,
      nextDocumentLayerIds: ReadonlySet<string>
    ) => {
      setGroupIds(new Set())
      setIframeLayerIds(new Set(nextIframeLayerIds))
      setDocumentLayerIds(new Set(nextDocumentLayerIds))
    },
    []
  )

  const clear = useCallback(() => {
    setIframeLayerIds(new Set())
    setGroupIds(new Set())
    setDocumentLayerIds(new Set())
  }, [])

  const deleteSelected = useCallback((): boolean => {
    const result = resolveSelectionDelete(current(), groupSnapshotsRef.current)
    if (!result.hasRemovals) return false
    if (result.removeIframeLayerIds.length > 0)
      removeIframeLayers(result.removeIframeLayerIds)
    if (result.removeMarkdownLayerIds.length > 0)
      removeDocumentLayers(result.removeMarkdownLayerIds)
    setIframeLayerIds(new Set(result.nextSelection.iframeLayerIds))
    setGroupIds(new Set(result.nextSelection.groupIds))
    setDocumentLayerIds(new Set(result.nextSelection.markdownLayerIds))
    return true
  }, [current, removeIframeLayers, removeDocumentLayers])

  const removeIframeLayerAndReselect = useCallback(
    (id: string) => {
      const next = nextIframeLayerAfterDelete(id, groupSnapshotsRef.current)
      removeIframeLayers([id])
      if (next) {
        setIframeLayerIds(new Set([next]))
        setGroupIds(new Set())
        setDocumentLayerIds(new Set())
      } else {
        setIframeLayerIds(new Set())
      }
    },
    [removeIframeLayers]
  )

  const removeGroupFromSelection = useCallback((groupId: string) => {
    setGroupIds((prev) => {
      if (!prev.has(groupId)) return prev
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
  }, [])

  const overlaySelectedIds = useMemo(
    () =>
      overlaySelectedIdsPure({
        iframeLayerIds,
        groupIds,
        markdownLayerIds: documentLayerIds,
      }),
    [iframeLayerIds, groupIds, documentLayerIds]
  )

  const groupSelectedIframeLayerIds = useMemo(
    () =>
      groupSelectedMemberIds(
        { iframeLayerIds, groupIds, markdownLayerIds: documentLayerIds },
        groupSnapshots
      ),
    [iframeLayerIds, groupIds, documentLayerIds, groupSnapshots]
  )

  return {
    iframeLayerIds,
    groupIds,
    documentLayerIds,
    overlaySelectedIds,
    groupSelectedIframeLayerIds,
    current,
    selectIframeLayer,
    selectGroup,
    selectDocumentLayer,
    selectMember,
    applyMarquee,
    clear,
    deleteSelected,
    removeIframeLayerAndReselect,
    removeGroupFromSelection,
    setIframeLayerIds,
    setGroupIds,
    setDocumentLayerIds,
  }
}
