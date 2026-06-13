import { descendantFolderIds, type CascadeFolder } from "@/lib/folder-cascade"

// Pure, React-free decision logic for drag-drop filing (issue #487). Folder
// tiles/rows are drop targets; dragging a canvas or folder onto a folder files
// it there. This module just decides *what* a drop should do — the component
// layer (`components/home/file-dnd.tsx`) wires it to dnd-kit and the move
// actions. Keeping the rule here lets the cycle guard be unit-tested without a
// DOM, and reuses the very same `descendantFolderIds` the "Move to…" dialog and
// the server-side `moveFolder` guard use, so all three reject the same moves.

/** The item picked up in a drag: a canvas (Room) or a folder. */
export type FileDragItem = {
  kind: "room" | "folder"
  id: string
  name: string
  /** Where it currently lives (null = the "All files" root); used to skip no-ops. */
  currentParentId: string | null
}

/** The move a drop resolves to — fed straight to `moveRoom` / `moveFolder`. */
export type FileDropPlan = {
  kind: "room" | "folder"
  id: string
  /** The destination folder the item was dropped on. */
  targetId: string
}

/**
 * Decide what dropping `item` onto folder `targetId` should do. Returns the move
 * to commit, or `null` when the drop changes nothing (already filed there) or is
 * rejected — a folder dropped onto itself or one of its descendants would create
 * a cycle. `descendantFolderIds` includes the folder itself, so the self-drop is
 * covered by the same check, matching the dialog's guard and `canMoveFolder`.
 */
export function planFileDrop(
  item: FileDragItem,
  targetId: string,
  folders: readonly CascadeFolder[]
): FileDropPlan | null {
  // Dropping where it already lives is a no-op, not a move.
  if (targetId === item.currentParentId) return null
  if (
    item.kind === "folder" &&
    descendantFolderIds(item.id, folders).includes(targetId)
  ) {
    return null
  }
  return { kind: item.kind, id: item.id, targetId }
}
