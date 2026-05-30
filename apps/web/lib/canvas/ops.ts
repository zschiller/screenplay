import type {
  AgentData,
  ChatSessionData,
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

  return { batch, patch, internal: { pruneIfEmpty } }
}
