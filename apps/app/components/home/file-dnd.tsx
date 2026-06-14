"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { descendantFolderIds } from "@/lib/folder-cascade"
import { planFileDrop, type FileDragItem } from "@/lib/file-dnd"
import type { FolderSummary } from "@/lib/folders-actions"
import { useHome } from "./home-provider"

// Drag-drop filing for the home (issue #487). A single DndContext spans the
// whole home shell — the folder section, the canvas list, *and* the sidebar — so
// a canvas or folder can be dragged onto any folder tile/row to file it there, or
// onto a pinned folder / the "All files" root in the sidebar. All paths reuse the
// same move path and cycle guard as the "Move to…" dialog. Breadcrumb crumbs are
// deliberately not drop targets. Built on the same dnd-kit setup as the in-room
// sidebar (PointerSensor with a small activation distance so clicks/navigation
// still pass through).

// Carries the dragged item through dnd-kit's `active.data`, keyed so it can't be
// confused with any other payload on the event.
const DRAG_DATA_KEY = "fileDragItem"
// Carries the drag preview node — the very same tile "face" the source renders,
// so the floating overlay can never drift out of sync with the real tile.
const DRAG_PREVIEW_KEY = "fileDragPreview"

type FileDndContextValue = {
  activeItem: FileDragItem | null
  /**
   * Folder ids the active drag can't land on — a dragged folder's own subtree
   * (itself included). Empty when dragging a canvas, which can go anywhere.
   */
  blocked: Set<string>
}

const FileDndContext = createContext<FileDndContextValue | null>(null)

/**
 * Make a canvas or folder draggable. `disabled` turns it off where filing makes
 * no sense (the flat Recents view has no folders to file into). `preview` is the
 * node the DragOverlay floats under the cursor — pass the *same* face component
 * the tile renders so the preview stays a pixel-exact copy of the source.
 */
export function useFileDraggable(
  item: FileDragItem,
  opts: { disabled?: boolean; preview?: React.ReactNode } = {}
) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${item.kind}:${item.id}`,
    data: { [DRAG_DATA_KEY]: item, [DRAG_PREVIEW_KEY]: opts.preview },
    disabled: opts.disabled,
  })
  return { attributes, listeners, setNodeRef, isDragging }
}

/**
 * Make a folder a drop target. It's disabled (no hover affordance, rejects the
 * drop) when the active drag is the folder itself or one of its descendants, so
 * a cycle can never be formed by dropping. `isOver` is true only while a valid
 * drag hovers it, which the tile/row uses to paint its active affordance.
 *
 * The same folder can be a drop target in two places at once — its grid tile and
 * its pinned sidebar row — and dnd-kit keys its droppable registry by id, so two
 * droppables sharing one id clobber each other (only one stays hittable). The
 * `scope` keeps each registration's id unique; the move still resolves off the
 * `folderId` in the data payload, so both behave identically.
 */
export function useFolderDroppable(folderId: string, scope = "grid") {
  const ctx = useContext(FileDndContext)
  const disabled = ctx ? ctx.blocked.has(folderId) : true
  const { setNodeRef, isOver } = useDroppable({
    id: `${scope}:folder:${folderId}`,
    data: { folderId },
    disabled,
  })
  return { setNodeRef, isOver: isOver && !disabled }
}

/**
 * Make the "All files" root a drop target, so an item dragged onto the sidebar's
 * "All files" entry is filed back at the top of the tree. The root is never a
 * cycle, so it's always enabled; `planFileDrop` skips the no-op when the item
 * already lives there. The `folderId: null` payload is what `handleDragEnd`
 * reads to resolve the move to the root.
 */
export function useRootDroppable() {
  const { setNodeRef, isOver } = useDroppable({
    id: "file-dnd-root",
    data: { folderId: null },
  })
  return { setNodeRef, isOver }
}

/**
 * A folder is both a drag source (file it elsewhere) and a drop target (file
 * things into it), so it needs both refs merged onto its one root node.
 */
export function useFolderDragDrop(
  folder: FolderSummary,
  preview?: React.ReactNode
) {
  const {
    attributes,
    listeners,
    isDragging,
    setNodeRef: setDragRef,
  } = useFileDraggable(
    {
      kind: "folder",
      id: folder.id,
      name: folder.name,
      currentParentId: folder.parentFolderId,
    },
    { preview }
  )
  const { isOver, setNodeRef: setDropRef } = useFolderDroppable(folder.id)
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )
  return { setNodeRef, attributes, listeners, isDragging, isOver }
}

/**
 * Wraps the whole home shell (sidebar + content) in a DndContext so a drag
 * started on any canvas/folder can drop onto any folder tile, any pinned folder
 * row, or the "All files" root. On drop, resolves the move with `planFileDrop`
 * (the shared cycle guard) and commits it through the home provider's `moveRoom`
 * / `moveFolder` — the same server path the dialog uses. Mounted once at the
 * shell so the sidebar and content share one context; the per-tile draggables
 * stay disabled outside folder views, so nothing picks up in flat Recents.
 */
export function FileDndProvider({ children }: { children: React.ReactNode }) {
  const { moveRoom, moveFolder, allFolders } = useHome()
  const [activeItem, setActiveItem] = useState<FileDragItem | null>(null)
  // The source tile's own preview node and its on-screen width, snapshotted at
  // drag start so the overlay renders a same-size, same-look copy.
  const [activePreview, setActivePreview] = useState<React.ReactNode>(null)
  const [activeWidth, setActiveWidth] = useState<number | null>(null)

  const sensors = useSensors(
    // A 6px activation distance lets plain clicks (navigation, the ⋮ menu) pass
    // through; only a real drag past the threshold picks the item up.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // While dragging a folder, its own subtree is off-limits as a destination.
  const blocked = useMemo(
    () =>
      activeItem?.kind === "folder"
        ? new Set(descendantFolderIds(activeItem.id, allFolders))
        : new Set<string>(),
    [activeItem, allFolders]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const item = event.active.data.current?.[DRAG_DATA_KEY] as
      | FileDragItem
      | undefined
    setActiveItem(item ?? null)
    setActivePreview(event.active.data.current?.[DRAG_PREVIEW_KEY] ?? null)
    setActiveWidth(event.active.rect.current.initial?.width ?? null)
  }, [])

  const resetDrag = useCallback(() => {
    setActiveItem(null)
    setActivePreview(null)
    setActiveWidth(null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const item = activeItem
      resetDrag()
      if (!item) return
      const over = event.over
      // No droppable under the pointer (released over empty space) → no move.
      // Folder targets carry their id; the "All files" root carries `null`, so
      // read the key's presence — not its truthiness — to tell them apart.
      if (!over) return
      const targetId = (over.data.current?.folderId ?? null) as string | null
      const plan = planFileDrop(item, targetId, allFolders)
      if (!plan) return
      // Fire-and-forget like the dialog's onMove; the provider patches local
      // state optimistically so the item leaves the view without a reload.
      if (plan.kind === "room") void moveRoom(plan.id, plan.targetId)
      else void moveFolder(plan.id, plan.targetId)
    },
    [activeItem, allFolders, moveRoom, moveFolder, resetDrag]
  )

  return (
    <FileDndContext.Provider value={{ activeItem, blocked }}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={resetDrag}
        autoScroll={{
          // dnd-kit auto-scrolls the nearest scrollable ancestor of whatever the
          // drag is over. The sidebar's content is `overflow-auto`, so hovering
          // its drop targets (pinned folders, "All files") would let the drag
          // scroll it — including sideways, which shoves the fixed two-pane
          // layout off-screen. Forbid scrolling the sidebar; the content grid
          // still auto-scrolls, so dragging toward an off-screen folder works.
          canScroll: (element) =>
            !(element instanceof HTMLElement) ||
            element.dataset.sidebar !== "content",
        }}
      >
        {children}
        {/* The overlay just floats the source tile's own preview node, sized to
            the width it had on the page — so it's a pixel-exact copy and there's
            no second copy of the tile markup to keep in sync. */}
        <DragOverlay dropAnimation={null}>
          {activePreview ? (
            <div style={{ width: activeWidth ?? undefined }}>
              {activePreview}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </FileDndContext.Provider>
  )
}
