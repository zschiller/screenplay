import { useCallback, useMemo } from "react"

import type { CanvasOps } from "@/lib/canvas/ops"
import type { RoomCollections } from "@/lib/yjs/schema"
import { chatStore } from "@/lib/chat-store"
import {
  getGroupMemberIds,
  getGroupMembers,
  placeNewIframeLayerGroup,
} from "@/lib/canvas/layout"
import type { GroupMember } from "@/lib/types"
import type { CanvasSelection } from "@/components/canvas/use-canvas-selection"

/**
 * Group Operations controller (PRD #588) — the structural sibling of
 * `useLayerMutations`. Where the Layer Mutation controller is "write a field on
 * one Layer," this controller is "create / move / reorder / remove the groups
 * and frames themselves": the ~structural canvas mutations that used to sit as
 * loose `useCallback`s in `components/canvas/canvas.tsx`.
 *
 * It owns frame creation (blank frame, frame-for-agent, routes-group-for-agent,
 * append-to-group), document creation, cross-group member move, group reorder,
 * group rename, and group delete — bundled into one `GroupActions` object the
 * Canvas root threads into the render tree, the way `selection` / `camera` /
 * `layerMutations` already are.
 *
 * Like `useLayerMutations`, this is the React binding, not a new write path:
 * **every mutation routes through the Canvas Operations seam (`ops`, ADR 0001)
 * and never touches the Y.Doc directly**, so the single-transaction entry point,
 * the Group-invariant chokepoint, and the uniform origin are all preserved. The
 * composed verbs keep their full bodies rather than flattening to a bare
 * `patch`: `moveMember` keeps its cross-group splice + new-group placement,
 * `removeIframeLayerGroup` keeps its chat-store cleanup + selection follow, and
 * the route/seed creators keep their viewport-centered placement.
 *
 * Constructed from `ops`, the live `collections`, the viewport-center reader
 * (Camera), the Chat-Target memory (`rememberDocChat`, for a new document's
 * chat), and the Selection controller (for the delete-follow on group teardown).
 *
 * Note: the two thin multi-Layer remove wrappers (`removeIframeLayers` /
 * `removeDocumentLayers`) stay on the Canvas root because the Selection
 * controller consumes them at construction, ahead of this controller — but the
 * composed group teardown that uses them (`removeIframeLayerGroup`) lives here.
 */
export interface GroupActionInputs {
  ops: CanvasOps
  collections: RoomCollections
  /** Viewport center in canvas space — placement for the route/seed creators. */
  getViewportCenter: () => { cx: number; cy: number }
  /** Chat-Target memory — remember a new document's seeded chat. */
  rememberDocChat: (markdownLayerId: string, chatId: string) => void
  /** Selection controller — `removeIframeLayerGroup` drops the deleted group. */
  selection: CanvasSelection
}

export interface GroupActions {
  // --- Frame creation ---
  /** Add an empty frame not bound to any agent/branch/route. New single-member group. */
  addFrame: (x: number, y: number, width: number, height: number) => string
  /** Add a frame for a running agent (the manual "add screen" button). New group. */
  addIframeLayer: (agentId: string, label: string) => string | undefined
  /**
   * Create a new group for an agent with one frame per discovered route,
   * placed near the viewport center. Returns the new group + its first frame.
   */
  addRoutesGroupForAgent: (
    agentId: string,
    routes: { route: string; label: string }[]
  ) => { groupId: string; firstIframeLayerId: string } | undefined
  /** Append a new frame to an existing group, mirroring the last sibling. */
  addIframeLayerToGroup: (groupId: string) => string | undefined

  // --- Document creation ---
  /** Wrap a new document in a fresh single-member group at the given coords. */
  addDocumentLayer: (
    canvasX: number,
    canvasY: number,
    width: number,
    height: number
  ) => string

  // --- Structural group mutations ---
  /** Move a single member across groups (Figma-style sidebar drag). */
  moveMember: (
    member: GroupMember,
    target:
      | { kind: "into-group"; groupId: string; index: number }
      | { kind: "new-group"; sidebarIndex: number }
  ) => void
  /** Reorder groups in the sidebar Frames list. */
  reorderIframeLayerGroups: (orderedIds: string[]) => void
  /** Rename a group. */
  renameIframeLayerGroup: (groupId: string, name: string) => void
  /** Delete an entire group + all its members (iframeLayers, markdownLayers). */
  removeIframeLayerGroup: (groupId: string) => void
}

export function useGroupActions({
  ops,
  collections,
  getViewportCenter,
  rememberDocChat,
  selection,
}: GroupActionInputs): GroupActions {
  // Depend on the stable verb, not the whole (re-created-each-render) selection
  // object, so the teardown verb stays `useCallback`-stable.
  const { removeGroupFromSelection } = selection

  /** Add an empty frame not associated with any agent/branch/route. Creates a new single-iframeLayer group. */
  const addFrame = useCallback(
    (x: number, y: number, width: number, height: number): string => {
      return ops.createBlankFrame({ x, y }, { width, height })
    },
    [ops]
  )

  /** Add an iframeLayer — used by the manual "add screen" button. Always creates a fresh group. */
  const addIframeLayer = useCallback(
    (agentId: string, label: string): string | undefined => {
      const agent = collections.branches.get(agentId)
      if (!agent || agent.status !== "running") return
      const { cx, cy } = getViewportCenter()
      return ops.createFrameForAgent(agentId, { x: cx, y: cy }, label).layerId
    },
    [collections, getViewportCenter, ops]
  )

  /**
   * Create a new group for an agent containing one iframeLayer per discovered
   * route. The group is positioned to the right of all existing groups,
   * top-aligned with the topmost. Returns the new group's id and the id of
   * its first iframeLayer (handy for zooming after the DOM updates).
   */
  const addRoutesGroupForAgent = useCallback(
    (
      agentId: string,
      routes: { route: string; label: string }[]
    ): { groupId: string; firstIframeLayerId: string } | undefined => {
      const { cx, cy } = getViewportCenter()
      const result = ops.createFramesForRoutes(agentId, routes, {
        x: cx,
        y: cy,
      })
      if (!result) return
      return {
        groupId: result.groupId,
        firstIframeLayerId: result.firstLayerId,
      }
    },
    [getViewportCenter, ops]
  )

  const addIframeLayerToGroup = useCallback(
    (groupId: string): string | undefined => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group) return
      const members = getGroupMembers(group)
      if (members.length === 0) return
      // Mirror the last *iframeLayer* sibling for size/agent/route when one
      // exists. For doc-only groups, fall back to the last member's bounds
      // so the new frame visually replaces the placeholder rect the user
      // just clicked.
      const iframeLayerIds = getGroupMemberIds(group, "iframe-layer")
      const lastIframeLayerId = iframeLayerIds[iframeLayerIds.length - 1]
      const lastIframeLayer = lastIframeLayerId
        ? collections.iframeLayers.get(lastIframeLayerId)
        : undefined
      let width: number
      let height: number
      let branchId: string | undefined
      let route: string | undefined
      if (lastIframeLayer) {
        width = lastIframeLayer.width
        height = lastIframeLayer.height
        branchId = lastIframeLayer.branchId
        route = lastIframeLayer.route
      } else {
        const lastMember = members[members.length - 1]!
        const lastDoc = collections.markdownLayers.get(lastMember.id)
        if (!lastDoc) return
        width = lastDoc.width
        height = lastDoc.height
      }
      return ops.addFrameToGroup(groupId, {
        width,
        height,
        label: branchId ? `Frame ${iframeLayerIds.length + 1}` : "Frame",
        ...(branchId ? { branchId } : {}),
        ...(route ? { route } : {}),
      })
    },
    [collections, ops]
  )

  /**
   * Wrap a new document in a fresh single-member group at the given canvas
   * coords. Mirrors `addFrame` so docs and iframeLayers have parallel
   * "create at canvas position" entry points.
   */
  const addDocumentLayer = useCallback(
    (
      canvasX: number,
      canvasY: number,
      width: number,
      height: number
    ): string => {
      const { docId, chatId } = ops.createDocument(
        { x: canvasX, y: canvasY },
        { width, height }
      )
      rememberDocChat(docId, chatId)
      return docId
    },
    [ops, rememberDocChat]
  )

  /** Reorder groups in the sidebar Frames list. */
  const reorderIframeLayerGroups = useCallback(
    (orderedIds: string[]) => {
      ops.batch(() => {
        orderedIds.forEach((id, index) => {
          ops.patch("iframeLayerGroups", id, { sidebarOrder: index })
        })
      })
    },
    [ops]
  )

  /**
   * Move a single member across groups (Figma-style sidebar drag). Handles
   * three cases in one transaction so undo is atomic:
   *  - drop into an existing group at a specific index
   *  - drop into the gap between groups → spawn a new single-member group
   *    placed near the viewport center, then renumber `sidebarOrder`
   *  - either case may leave the source group empty → delete it
   */
  const moveMember = useCallback(
    (
      member: GroupMember,
      target:
        | { kind: "into-group"; groupId: string; index: number }
        | { kind: "new-group"; sidebarIndex: number }
    ) => {
      const allGroups = collections.iframeLayerGroups.toArray()
      const sourceGroup = allGroups.find((g) =>
        getGroupMembers(g).some(
          (m) => m.kind === member.kind && m.id === member.id
        )
      )
      if (!sourceGroup) return

      if (target.kind === "into-group") {
        // Cross-group move or same-group reorder — the verb finds the source,
        // splices the member into the target at `index`, and prunes the source
        // if the move empties it.
        ops.moveLayerToGroup(member.id, target.groupId, target.index)
        return
      }

      // target.kind === "new-group" — split the member into a fresh group, then
      // renumber sidebar order so it slots in at the requested index. Placement
      // (canvas-space) is the caller's job; the verb owns the member move,
      // group creation/naming, and source pruning.
      const memberSize = (() => {
        if (member.kind === "iframe-layer") {
          const ab = collections.iframeLayers.get(member.id)
          return ab ? { width: ab.width, height: ab.height } : null
        }
        if (member.kind === "markdown-layer") {
          const d = collections.markdownLayers.get(member.id)
          return d ? { width: d.width, height: d.height } : null
        }
        return null
      })()
      if (!memberSize) return

      const sourceWillEmpty =
        getGroupMembers(sourceGroup).filter(
          (m) => !(m.kind === member.kind && m.id === member.id)
        ).length === 0
      const { cx, cy } = getViewportCenter()
      const groupsForPlacement = allGroups.filter(
        (g) => g.id !== sourceGroup.id || !sourceWillEmpty
      )
      const { x, y } = placeNewIframeLayerGroup(
        groupsForPlacement,
        collections.iframeLayers.toArray(),
        { x: cx, y: cy },
        memberSize.width,
        memberSize.height
      )

      // One batch so the split + sidebar renumber land as a single undo step.
      ops.batch(() => {
        const newGroupId = ops.splitToNewGroup([member.id], { x, y })
        // Renumber sidebarOrder over the post-mutation set so the new group
        // lands at target.sidebarIndex. Use the freshly read snapshot, then
        // splice in the new id; an `update` on a pruned source is a no-op.
        const orderedIds = collections.iframeLayerGroups
          .toArray()
          .filter((g) => g.id !== newGroupId)
          .sort((a, b) => (a.sidebarOrder ?? 0) - (b.sidebarOrder ?? 0))
          .map((g) => g.id)
        const clamped = Math.max(
          0,
          Math.min(target.sidebarIndex, orderedIds.length)
        )
        const finalOrder = [
          ...orderedIds.slice(0, clamped),
          newGroupId,
          ...orderedIds.slice(clamped),
        ]
        finalOrder.forEach((id, index) => {
          ops.patch("iframeLayerGroups", id, { sidebarOrder: index })
        })
      })
    },
    [collections, getViewportCenter, ops]
  )

  const renameIframeLayerGroup = useCallback(
    (groupId: string, name: string) => {
      ops.patch("iframeLayerGroups", groupId, { name })
    },
    [ops]
  )

  /** Delete an entire group + all its members (iframeLayers, markdownLayers). */
  const removeIframeLayerGroup = useCallback(
    (groupId: string) => {
      const g = collections.iframeLayerGroups.get(groupId)
      if (!g) return
      const members = getGroupMembers(g)
      const iframeLayerIds = members
        .filter((m) => m.kind === "iframe-layer")
        .map((m) => m.id)
      const documentIds = members
        .filter((m) => m.kind === "markdown-layer")
        .map((m) => m.id)
      // Compose both removal verbs under one batch so the group teardown is a
      // single transaction (one undo step). Each verb prunes the group as its
      // last member of that kind leaves.
      let removedChatIds: string[] = []
      ops.batch(() => {
        if (iframeLayerIds.length > 0) ops.removeLayers(iframeLayerIds)
        if (documentIds.length > 0) {
          removedChatIds = ops.removeDocuments(documentIds).removedChatIds
        }
      })
      for (const chatId of removedChatIds) chatStore.cleanup(chatId)
      removeGroupFromSelection(groupId)
    },
    [collections, ops, removeGroupFromSelection]
  )

  // Memoized so the controller object stays stable across renders (every verb is
  // `useCallback`-stable over its stable inputs); consumers list `groupActions`
  // whole in dep arrays — matching the other canvas controllers — without
  // re-binding long-lived handlers each render.
  return useMemo(
    () => ({
      addFrame,
      addIframeLayer,
      addRoutesGroupForAgent,
      addIframeLayerToGroup,
      addDocumentLayer,
      moveMember,
      reorderIframeLayerGroups,
      renameIframeLayerGroup,
      removeIframeLayerGroup,
    }),
    [
      addFrame,
      addIframeLayer,
      addRoutesGroupForAgent,
      addIframeLayerToGroup,
      addDocumentLayer,
      moveMember,
      reorderIframeLayerGroups,
      renameIframeLayerGroup,
      removeIframeLayerGroup,
    ]
  )
}
