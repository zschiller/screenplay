import * as Y from "yjs"
import { CANVAS_OPS_ORIGIN } from "@/lib/canvas/ops"
import { COLLECTION_KEYS } from "@/lib/yjs/schema"

/**
 * Canvas Undo — the room's `Y.UndoManager` for ⌘Z / ⌘⇧Z, and the one delete
 * rule: a canvas object that Undo can bring back deletes at once, with no
 * confirm and no toast. A delete is always its own undo step, so one ⌘Z
 * brings back exactly what went.
 *
 * What it tracks, on purpose:
 * - This member's own edits: transactions committed through Canvas Operations
 *   ({@link CANVAS_OPS_ORIGIN}) or directly with no origin (canvas memory).
 *   Everything that arrives from sync carries the provider as its origin, so
 *   another member's edits and the Coordinator's (it edits the server's copy,
 *   `lib/agent/room-arrange-tools.ts`) are never undone by someone's ⌘Z.
 * - Only edits to frames, documents, mockups, Groups, pages and memory
 *   entries. A transaction that only writes chat sessions or plans (run status, titles) is skipped,
 *   and so is one that touches repositories or Workspaces: those have
 *   server-side effects Undo can't reverse, so they keep their confirms.
 * - Not the fields a running prototype reports on its frame or Mockup (route,
 *   scroll, state, knob declarations), which sync the live page rather than
 *   record an edit anyone made.
 *
 * Chat sessions are in scope only so that undoing a document's deletion brings
 * its chat back with it, and members' page views (#1838) only so that undoing
 * a page's deletion brings back everyone's view of it: moving the camera is
 * never a step.
 *
 * A Mockup's page is a folder in the file store (#1886), outside the doc, so
 * Undo can't bring it back once it's gone: a Mockup file this member deleted
 * keeps its folder while their Undo could still restore it, and
 * `onMockupFilesGone` hears which are still deleted when this Undo goes (the
 * session ends), so the canvas can have them removed for real.
 */

/** Frame fields the prototype writes as it runs; ⌘Z never steps through them. */
const LIVE_FRAME_FIELDS: ReadonlySet<string> = new Set([
  "iframeState",
  "route",
  "scrollX",
  "scrollY",
  "knobs",
  "sharedState",
  // Going live is the frame's, like its route: not an edit to undo (#1516).
  "live",
  // Where a Mockup's live page runs, set as it goes live (#1523).
  "liveBranchId",
])

/** Collections whose records carry a running page's fields: frames, and
 *  Mockups, whose pages declare knobs too. */
const LIVE_KEYS: ReadonlySet<string> = new Set([
  COLLECTION_KEYS.iframeLayers,
  COLLECTION_KEYS.mockupLayers,
  // A Mockup's page state is its file's (#1883).
  COLLECTION_KEYS.layerFiles,
])

/** The collections a member edits on the canvas. */
const EDITABLE_KEYS = [
  COLLECTION_KEYS.iframeLayers,
  COLLECTION_KEYS.iframeLayerGroups,
  COLLECTION_KEYS.markdownLayers,
  COLLECTION_KEYS.mockupLayers,
  COLLECTION_KEYS.layerFiles,
  COLLECTION_KEYS.memories,
  COLLECTION_KEYS.pages,
] as const

/** Collections whose writes make a transaction not undoable at all. */
const LIFECYCLE_KEYS = [COLLECTION_KEYS.repos, COLLECTION_KEYS.branches]

export type CanvasUndo = {
  undo(): void
  redo(): void
  /**
   * Mockup files this member deleted that are still gone: their folders go
   * when this Undo does. Read on the way out of the page, too.
   */
  deletedMockupFiles(): string[]
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
  options: { onMockupFilesGone?: (fileIds: string[]) => void } = {}
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
        !LIVE_KEYS.has(owner.key) ||
        [...keys].some((k) => k === null || !LIVE_FRAME_FIELDS.has(k))
      ) {
        edit = true
      }
    }
    return edit
  }

  function deletes(tr: Y.Transaction): boolean {
    for (const [type, ids] of tr.changed) {
      const key = maps.get(type)
      if (!key || !editable.has(key)) continue
      const map = doc.getMap(key)
      for (const id of ids) if (id !== null && !map.has(id)) return true
    }
    return false
  }

  const tracked = new Set<unknown>([CANVAS_OPS_ORIGIN, null])

  // Registered before the UndoManager so it runs first on each transaction: a
  // delete starts its own undo step rather than joining an edit made a moment
  // before it, so ⌘Z reverses the delete and nothing else.
  let deleting = false
  const beforeUndoManager = (tr: Y.Transaction) => {
    deleting = tracked.has(tr.origin) && isCanvasEdit(tr) && deletes(tr)
    if (deleting) mgr.stopCapturing()
  }
  doc.on("afterTransaction", beforeUndoManager)

  const mgr: Y.UndoManager = new Y.UndoManager(
    [
      ...EDITABLE_KEYS.map((k) => doc.getMap(k)),
      doc.getMap(COLLECTION_KEYS.chatSessions),
      doc.getMap(COLLECTION_KEYS.pageViews),
    ],
    {
      captureTimeout: 500,
      trackedOrigins: tracked,
      // Undo and redo run as transactions with the manager as their origin;
      // those always count.
      captureTransaction: (tr) => tr.origin === mgr || isCanvasEdit(tr),
    }
  )

  // Mockup files (#1886): every one in the doc, and the ones this member
  // deleted that are still gone.
  const files = doc.getMap<Y.Map<unknown>>(COLLECTION_KEYS.layerFiles)
  const mockupFiles = new Set<string>()
  for (const [id, file] of files) {
    if (file instanceof Y.Map && file.get("kind") === "mockup") {
      mockupFiles.add(id)
    }
  }
  const deletedByMe = new Set<string>()
  const watchMockupFiles = (tr: Y.Transaction) => {
    let ids: Set<string | null> | undefined
    for (const [type, keys] of tr.changed) {
      if ((type as object) === files) ids = keys
    }
    if (!ids) return
    const mine = tr.origin === mgr || tracked.has(tr.origin)
    for (const id of ids) {
      if (id === null) continue
      const file = files.get(id)
      if (file instanceof Y.Map) {
        if (file.get("kind") === "mockup") mockupFiles.add(id)
        // Undone, or put back some other way: its folder stays.
        deletedByMe.delete(id)
      } else if (mockupFiles.delete(id) && mine) {
        deletedByMe.add(id)
      }
    }
  }
  doc.on("afterTransaction", watchMockupFiles)
  const stillGone = () => [...deletedByMe].filter((id) => !files.has(id))

  mgr.on("stack-item-added", ({ type, origin }) => {
    if (!deleting || type !== "undo" || origin === mgr) return
    deleting = false
    // Later edits start their own step too, so they don't widen this one.
    mgr.stopCapturing()
  })

  return {
    undo: () => {
      mgr.undo()
    },
    redo: () => {
      mgr.redo()
    },
    deletedMockupFiles: stillGone,
    destroy: () => {
      doc.off("afterTransaction", beforeUndoManager)
      doc.off("afterTransaction", watchMockupFiles)
      mgr.destroy()
      const gone = stillGone()
      if (gone.length) options.onMockupFilesGone?.(gone)
    },
  }
}
