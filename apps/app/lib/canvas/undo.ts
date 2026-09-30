import * as Y from "yjs"
import { CANVAS_OPS_ORIGIN } from "@/lib/canvas/ops"
import { COLLECTION_KEYS } from "@/lib/yjs/schema"

/**
 * Canvas Undo — the room's `Y.UndoManager` for ⌘Z / ⌘⇧Z, and the one delete
 * rule: a canvas object that Undo can bring back deletes at once, and the
 * caller offers Undo in a toast (see `onDelete`).
 *
 * What it tracks, on purpose:
 * - This member's own edits: transactions committed through Canvas Operations
 *   ({@link CANVAS_OPS_ORIGIN}) or directly with no origin (canvas memory).
 *   Everything that arrives from sync carries the provider as its origin, so
 *   another member's edits and the Coordinator's (it edits the server's copy,
 *   `lib/agent/room-arrange-tools.ts`) are never undone by someone's ⌘Z.
 * - Only edits to frames, documents, Groups and memory entries. A transaction
 *   that only writes chat sessions or plans (run status, titles) is skipped,
 *   and so is one that touches repositories or Workspaces: those have
 *   server-side effects Undo can't reverse, so they keep their confirms.
 * - Not the fields a running prototype reports on its frame (route, scroll,
 *   state, knob declarations), which sync the live page rather than record an
 *   edit anyone made.
 *
 * Chat sessions are in scope only so that undoing a document's deletion brings
 * its chat back with it.
 */

/** Frame fields the prototype writes as it runs; ⌘Z never steps through them. */
const LIVE_FRAME_FIELDS: ReadonlySet<string> = new Set([
  "iframeState",
  "route",
  "scrollX",
  "scrollY",
  "knobs",
  "sharedState",
])

/** The collections a member edits on the canvas. */
const EDITABLE_KEYS = [
  COLLECTION_KEYS.iframeLayers,
  COLLECTION_KEYS.iframeLayerGroups,
  COLLECTION_KEYS.markdownLayers,
  COLLECTION_KEYS.memories,
] as const

/** Collections whose writes make a transaction not undoable at all. */
const LIFECYCLE_KEYS = [COLLECTION_KEYS.repos, COLLECTION_KEYS.branches]

type EditableKey = (typeof EDITABLE_KEYS)[number]

/** How many entries of each kind one undo step deleted. */
export type DeletedCounts = Record<EditableKey, number>

/** A just-deleted step, while it's still the one Undo would reverse. */
export type DeleteStep = {
  counts: DeletedCounts
  /** Undoes exactly this step. A no-op once anything newer is on the stack. */
  undo(): void
  /**
   * Calls `cb` once, when this step stops being the latest: it was undone
   * (from here or ⌘Z), or a newer edit went on the stack.
   */
  onSettled(cb: () => void): void
}

export type CanvasUndo = {
  undo(): void
  redo(): void
  destroy(): void
}

/** The collection a changed type belongs to: a top-level map or one entry of it. */
function collectionOf(
  type: object,
  maps: ReadonlyMap<object, string>
): { key: string; entry: boolean } | null {
  const top = maps.get(type)
  if (top) return { key: top, entry: false }
  const parent = (type as { _item?: Y.Item | null })._item?.parent
  const parentKey =
    parent instanceof Y.AbstractType ? maps.get(parent) : undefined
  return parentKey ? { key: parentKey, entry: true } : null
}

export function createCanvasUndo(
  doc: Y.Doc,
  { onDelete }: { onDelete?: (step: DeleteStep) => void } = {}
): CanvasUndo {
  const maps = new Map<object, string>()
  for (const key of [...EDITABLE_KEYS, ...LIFECYCLE_KEYS]) {
    maps.set(doc.getMap(key), key)
  }
  const editable = new Set<string>(EDITABLE_KEYS)
  const lifecycle = new Set<string>(LIFECYCLE_KEYS)

  function isCanvasEdit(tr: Y.Transaction): boolean {
    let edit = false
    for (const [type, keys] of tr.changed) {
      const owner = collectionOf(type, maps)
      if (!owner) continue
      if (lifecycle.has(owner.key)) return false
      if (!editable.has(owner.key)) continue
      if (
        !owner.entry ||
        owner.key !== COLLECTION_KEYS.iframeLayers ||
        [...keys].some((k) => k === null || !LIVE_FRAME_FIELDS.has(k))
      ) {
        edit = true
      }
    }
    return edit
  }

  function deletedCounts(tr: Y.Transaction): DeletedCounts | null {
    const counts = Object.fromEntries(
      EDITABLE_KEYS.map((k) => [k, 0])
    ) as DeletedCounts
    let any = false
    for (const [type, ids] of tr.changed) {
      const key = maps.get(type)
      if (!key || !editable.has(key)) continue
      const map = doc.getMap(key)
      for (const id of ids) {
        if (id !== null && !map.has(id)) {
          counts[key as EditableKey]++
          any = true
        }
      }
    }
    return any ? counts : null
  }

  const tracked = new Set<unknown>([CANVAS_OPS_ORIGIN, null])

  // Registered before the UndoManager so it runs first on each transaction: a
  // delete starts its own undo step rather than joining an edit made a moment
  // before it, so the toast's Undo reverses the delete and nothing else.
  let pending: DeletedCounts | null = null
  const beforeUndoManager = (tr: Y.Transaction) => {
    pending = null
    if (!tracked.has(tr.origin) || !isCanvasEdit(tr)) return
    pending = deletedCounts(tr)
    if (pending) mgr.stopCapturing()
  }
  doc.on("afterTransaction", beforeUndoManager)

  const mgr: Y.UndoManager = new Y.UndoManager(
    [
      ...EDITABLE_KEYS.map((k) => doc.getMap(k)),
      doc.getMap(COLLECTION_KEYS.chatSessions),
    ],
    {
      captureTimeout: 500,
      trackedOrigins: tracked,
      // Undo and redo run as transactions with the manager as their origin;
      // those always count.
      captureTransaction: (tr) => tr.origin === mgr || isCanvasEdit(tr),
    }
  )

  mgr.on("stack-item-added", ({ stackItem, type, origin }) => {
    const counts = pending
    pending = null
    if (!counts || type !== "undo" || origin === mgr || !onDelete) return
    // Later edits start their own step too, so they don't widen this one.
    mgr.stopCapturing()

    let settled = false
    const listeners: Array<() => void> = []
    const settle = () => {
      if (settled) return
      settled = true
      mgr.off("stack-item-added", onAdded)
      mgr.off("stack-item-popped", onPopped)
      mgr.off("stack-cleared", settle)
      for (const cb of listeners) cb()
    }
    const onAdded = (e: { type: "undo" | "redo" }) => {
      if (e.type === "undo") settle()
    }
    const onPopped = (e: { stackItem: unknown }) => {
      if (e.stackItem === stackItem) settle()
    }
    mgr.on("stack-item-added", onAdded)
    mgr.on("stack-item-popped", onPopped)
    mgr.on("stack-cleared", settle)

    onDelete({
      counts,
      undo: () => {
        if (!settled && mgr.undoStack.at(-1) === stackItem) mgr.undo()
      },
      onSettled: (cb) => {
        if (settled) cb()
        else listeners.push(cb)
      },
    })
  })

  return {
    undo: () => {
      mgr.undo()
    },
    redo: () => {
      mgr.redo()
    },
    destroy: () => {
      doc.off("afterTransaction", beforeUndoManager)
      mgr.destroy()
    },
  }
}

/** The toast's line for a delete: “Frame deleted”, “3 items deleted”. */
export function deletedMessage(counts: DeletedCounts): string {
  const frames = counts[COLLECTION_KEYS.iframeLayers]
  const documents = counts[COLLECTION_KEYS.markdownLayers]
  const memories = counts[COLLECTION_KEYS.memories]
  const count = (n: number, one: string, many: string) =>
    n === 1 ? `${one} deleted` : `${n} ${many} deleted`
  if (frames > 0 && documents > 0) return `${frames + documents} items deleted`
  if (frames > 0) return count(frames, "Frame", "frames")
  if (documents > 0) return count(documents, "Document", "documents")
  if (memories > 0) return count(memories, "Memory", "memories")
  return "Group deleted"
}
