import { nanoid } from "nanoid"
import { getGroupMembers, nextGroupNumber } from "@/lib/iframe-layer-layout"
import type {
  AgentData,
  ChatSessionData,
  GroupMember,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  PlanData,
  WorkspaceData,
} from "@/lib/types"
import type {
  CommentPosition,
  RoomCollections,
  YjsCollection,
} from "@/lib/yjs/schema"

/**
 * Canvas Operations — the deep write-seam fronting the generic `YjsCollection`
 * CRDT wrapper for the room Y.Doc (see `apps/web/CONTEXT.md`, "Canvas
 * Operation"). `canvas.tsx` calls verbs here; orchestration, the Group
 * invariant, and transaction scoping live behind the seam, React-free.
 *
 * This module is the scaffold (slice 2, #157): `batch`, the generic `patch`,
 * the uniform {@link CANVAS_OPS_ORIGIN}, and the internal `pruneIfEmpty`
 * chokepoint that the meaning-bearing removal/restructure verbs (slice 3,
 * #158) will route every Member-removing write through. Tests construct it
 * against a bare `Y.Doc` with no React or Liveblocks.
 */

/**
 * The Yjs transaction origin stamped on every mutation committed through this
 * module. A single uniform origin is what lets a future `Y.UndoManager` track
 * exactly the canvas's own edits (and nothing from sync) for Undo/Redo.
 */
export const CANVAS_OPS_ORIGIN = Symbol("canvas-ops")

/** The keyed collections `patch` can write, mapped to their record type. */
type RecordByKey = {
  workspaces: WorkspaceData
  agents: AgentData
  iframeLayers: IframeLayerData
  iframeLayerGroups: IframeLayerGroupData
  markdownLayers: MarkdownLayerData
  chatSessions: ChatSessionData
  plans: PlanData
  commentPositions: CommentPosition
}
type CollectionKey = keyof RecordByKey

export type CanvasOps = {
  /** The sole way to open a transaction; wraps the body in the canvas-ops origin. */
  batch(fn: () => void): void
  /**
   * Trivial single-field write: merge `fields` onto an existing record in
   * `key`'s collection, within the canvas-ops origin. No-op when the record is
   * missing (mirrors `YjsCollection.update`). Sites that touch ≥2 collections,
   * enforce the Group invariant, or dual-write a fragment earn a named verb
   * instead.
   */
  patch<K extends CollectionKey>(
    key: K,
    id: string,
    fields: Partial<RecordByKey[K]>,
  ): void
  /**
   * Remove the given Iframe Layers and drop them from any Group that held
   * them, pruning a Group emptied by the removal. Iframe Layers own no Chat
   * Sessions, so `removedChatIds` is always empty — the field is present so
   * every delete verb shares one shape.
   */
  removeLayers(ids: string[]): { removedChatIds: string[] }
  /**
   * Remove the given Markdown Layers (Documents): drop them from any Group
   * (pruning a Group emptied by the removal) and delete the Chat Sessions
   * targeting them, returning those `removedChatIds` so the caller can clear
   * the client chat-store mirror.
   */
  removeDocuments(ids: string[]): { removedChatIds: string[] }
  /**
   * Remove an agent and everything keyed to it — its Iframe Layers, its Chat
   * Sessions, and its Members in any Group (pruning Groups emptied by the
   * cascade) — atomically. Returns the `removedChatIds` for the client mirror.
   */
  removeAgent(agentId: string): { removedChatIds: string[] }
  /**
   * Remove a workspace and cascade across every agent it owns — their Iframe
   * Layers, Chat Sessions, and Members (pruning Groups emptied by the cascade)
   * — atomically. Returns the `removedChatIds` for the client mirror.
   */
  removeWorkspace(id: string): { removedChatIds: string[] }
  /**
   * Move the Member with `layerId` out of whatever Group holds it and into
   * `targetGroupId` at `index` (appended when `index` is omitted), pruning the
   * source Group if the move empties it. When source and target are the same
   * Group this reorders the Member to `index`. No-op if the layer or target is
   * missing.
   */
  moveLayerToGroup(layerId: string, targetGroupId: string, index?: number): void
  /**
   * Merge the source Group into the target: append every source Member onto
   * the target's row and prune the emptied source. The target keeps its
   * world-space origin. No-op if either Group is missing, they are the same,
   * or the source is empty.
   */
  mergeGroups(sourceGroupId: string, targetGroupId: string): void
  /**
   * Detach `memberIds` from whatever Group(s) hold them and gather them — in
   * the given order — into a fresh Group anchored at `anchor` (canvas-space),
   * pruning any source Group the split empties. Returns the new Group's id.
   * The caller owns screen→canvas conversion and placement of `anchor`.
   */
  splitToNewGroup(memberIds: string[], anchor: { x: number; y: number }): string
  /**
   * @internal Not a public verb — the single Group-invariant chokepoint the
   * removal/restructure verbs (#158) route Member removal through. Exposed
   * here (behind `internal`) so those verbs and the invariant tests reach the
   * one implementation rather than re-deriving "delete the Group when its last
   * Member leaves".
   */
  internal: {
    pruneIfEmpty(groupId: string): void
  }
}

export function createCanvasOps(collections: RoomCollections): CanvasOps {
  const { doc } = collections

  function batch(fn: () => void): void {
    doc.transact(fn, CANVAS_OPS_ORIGIN)
  }

  function patch<K extends CollectionKey>(
    key: K,
    id: string,
    fields: Partial<RecordByKey[K]>,
  ): void {
    batch(() => {
      ;(collections[key] as YjsCollection<RecordByKey[K]>).update(id, fields)
    })
  }

  // The Group invariant (CONTEXT.md): no Group is ever *committed* with zero
  // Members. A Group may pass through zero Members inside a transaction, but is
  // pruned before it closes. Self-wraps in `batch` so it is safe to call
  // standalone and composes cleanly when a verb calls it inside its own batch
  // (nested Yjs transactions reuse the outer one, keeping the canvas-ops origin).
  function pruneIfEmpty(groupId: string): void {
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (group && (group.members?.length ?? 0) === 0) {
        collections.iframeLayerGroups.delete(groupId)
      }
    })
  }

  // The one Member-removal path every removal verb routes through: drop every
  // Member matching `match` from each Group, then prune the Groups the removal
  // emptied. Caller must already be inside a `batch`. `toArray()` is a
  // transaction-stable snapshot, so a single pass over the Groups is correct
  // even as members are rewritten underneath.
  function removeMembersMatching(match: (member: GroupMember) => boolean): void {
    for (const group of collections.iframeLayerGroups.toArray()) {
      const before = getGroupMembers(group)
      const remaining = before.filter((m) => !match(m))
      if (remaining.length === before.length) continue
      collections.iframeLayerGroups.update(group.id, { members: remaining })
      pruneIfEmpty(group.id)
    }
  }

  function removeLayers(ids: string[]): { removedChatIds: string[] } {
    if (ids.length === 0) return { removedChatIds: [] }
    const idSet = new Set(ids)
    batch(() => {
      for (const id of ids) collections.iframeLayers.delete(id)
      removeMembersMatching((m) => m.kind === "iframe-layer" && idSet.has(m.id))
    })
    return { removedChatIds: [] }
  }

  function removeDocuments(ids: string[]): { removedChatIds: string[] } {
    if (ids.length === 0) return { removedChatIds: [] }
    const idSet = new Set(ids)
    const removedChatIds: string[] = []
    batch(() => {
      for (const id of ids) collections.markdownLayers.delete(id)
      for (const chat of collections.chatSessions.toArray()) {
        if (chat.markdownLayerId && idSet.has(chat.markdownLayerId)) {
          collections.chatSessions.delete(chat.id)
          removedChatIds.push(chat.id)
        }
      }
      removeMembersMatching((m) => m.kind === "markdown-layer" && idSet.has(m.id))
    })
    return { removedChatIds }
  }

  function removeAgent(agentId: string): { removedChatIds: string[] } {
    const removedChatIds: string[] = []
    batch(() => {
      collections.agents.delete(agentId)
      const removedLayerIds = new Set<string>()
      for (const layer of collections.iframeLayers.toArray()) {
        if (layer.sandboxId === agentId) {
          collections.iframeLayers.delete(layer.id)
          removedLayerIds.add(layer.id)
        }
      }
      for (const chat of collections.chatSessions.toArray()) {
        if (chat.agentId === agentId) {
          collections.chatSessions.delete(chat.id)
          removedChatIds.push(chat.id)
        }
      }
      removeMembersMatching(
        (m) => m.kind === "iframe-layer" && removedLayerIds.has(m.id),
      )
    })
    return { removedChatIds }
  }

  function removeWorkspace(id: string): { removedChatIds: string[] } {
    const removedChatIds: string[] = []
    batch(() => {
      collections.workspaces.delete(id)
      const agentIds = new Set<string>()
      for (const agent of collections.agents.toArray()) {
        if (agent.workspaceId === id) {
          collections.agents.delete(agent.id)
          agentIds.add(agent.id)
        }
      }
      const removedLayerIds = new Set<string>()
      for (const layer of collections.iframeLayers.toArray()) {
        if (layer.sandboxId && agentIds.has(layer.sandboxId)) {
          collections.iframeLayers.delete(layer.id)
          removedLayerIds.add(layer.id)
        }
      }
      for (const chat of collections.chatSessions.toArray()) {
        if (chat.agentId && agentIds.has(chat.agentId)) {
          collections.chatSessions.delete(chat.id)
          removedChatIds.push(chat.id)
        }
      }
      removeMembersMatching(
        (m) => m.kind === "iframe-layer" && removedLayerIds.has(m.id),
      )
    })
    return { removedChatIds }
  }

  function moveLayerToGroup(
    layerId: string,
    targetGroupId: string,
    index?: number,
  ): void {
    batch(() => {
      const target = collections.iframeLayerGroups.get(targetGroupId)
      if (!target) return
      const source = collections.iframeLayerGroups
        .toArray()
        .find((g) => getGroupMembers(g).some((m) => m.id === layerId))
      if (!source) return
      const member = getGroupMembers(source).find((m) => m.id === layerId)
      if (!member) return

      const sourceRemaining = getGroupMembers(source).filter((m) => m.id !== layerId)
      // Drop any existing copy from the target's own list so a same-Group
      // reorder (source === target) splices the Member back in at `index`
      // rather than duplicating it.
      const targetMembers = getGroupMembers(target).filter((m) => m.id !== layerId)
      const at = index == null ? targetMembers.length : Math.max(0, Math.min(index, targetMembers.length))
      const nextTarget: GroupMember[] = [
        ...targetMembers.slice(0, at),
        member,
        ...targetMembers.slice(at),
      ]

      collections.iframeLayerGroups.update(source.id, { members: sourceRemaining })
      collections.iframeLayerGroups.update(target.id, { members: nextTarget })
      pruneIfEmpty(source.id)
    })
  }

  function mergeGroups(sourceGroupId: string, targetGroupId: string): void {
    if (sourceGroupId === targetGroupId) return
    batch(() => {
      const source = collections.iframeLayerGroups.get(sourceGroupId)
      const target = collections.iframeLayerGroups.get(targetGroupId)
      if (!source || !target) return
      const sourceMembers = getGroupMembers(source)
      if (sourceMembers.length === 0) return
      collections.iframeLayerGroups.update(target.id, {
        members: [...getGroupMembers(target), ...sourceMembers],
      })
      collections.iframeLayerGroups.update(source.id, { members: [] })
      pruneIfEmpty(source.id)
    })
  }

  function splitToNewGroup(
    memberIds: string[],
    anchor: { x: number; y: number },
  ): string {
    const newGroupId = nanoid()
    batch(() => {
      const idSet = new Set(memberIds)
      const memberById = new Map<string, GroupMember>()
      const touchedSources = new Set<string>()
      for (const group of collections.iframeLayerGroups.toArray()) {
        const members = getGroupMembers(group)
        let touched = false
        for (const m of members) {
          if (idSet.has(m.id)) {
            memberById.set(m.id, m)
            touched = true
          }
        }
        if (!touched) continue
        touchedSources.add(group.id)
        collections.iframeLayerGroups.update(group.id, {
          members: members.filter((m) => !idSet.has(m.id)),
        })
      }
      // Preserve caller-requested order; drop ids that matched no Member.
      const newMembers = memberIds
        .map((id) => memberById.get(id))
        .filter((m): m is GroupMember => m !== undefined)
      if (newMembers.length === 0) return
      collections.iframeLayerGroups.set(newGroupId, {
        id: newGroupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        x: anchor.x,
        y: anchor.y,
        members: newMembers,
      })
      for (const sourceId of touchedSources) pruneIfEmpty(sourceId)
    })
    return newGroupId
  }

  return {
    batch,
    patch,
    removeLayers,
    removeDocuments,
    removeAgent,
    removeWorkspace,
    moveLayerToGroup,
    mergeGroups,
    splitToNewGroup,
    internal: { pruneIfEmpty },
  }
}
