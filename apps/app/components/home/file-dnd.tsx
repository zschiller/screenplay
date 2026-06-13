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
import { File as FileIcon, Folder as FolderIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { descendantFolderIds } from "@/lib/folder-cascade"
import { planFileDrop, type FileDragItem } from "@/lib/file-dnd"
import { useHome } from "./home-provider"

// Drag-drop filing for the files page (issue #487). A single DndContext spans
// both the folder section and the canvas list, so a canvas or folder can be
// dragged onto any folder tile/row to file it there — reusing the same move
// path and cycle guard as the "Move to…" dialog. Moving *up* the tree stays the
// dialog's job; breadcrumb crumbs are deliberately not drop targets. Built on
// the same dnd-kit setup as the in-room sidebar (PointerSensor with a small
// activation distance so clicks/navigation still pass through).

// Carries the dragged item through dnd-kit's `active.data`, keyed so it can't be
// confused with any other payload on the event.
const DRAG_DATA_KEY = "fileDragItem"

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
 * no sense (the flat Recents view has no folders to file into).
 */
export function useFileDraggable(item: FileDragItem, disabled = false) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${item.kind}:${item.id}`,
    data: { [DRAG_DATA_KEY]: item },
    disabled,
  })
  return { attributes, listeners, setNodeRef, isDragging }
}

/**
 * Make a folder a drop target. It's disabled (no hover affordance, rejects the
 * drop) when the active drag is the folder itself or one of its descendants, so
 * a cycle can never be formed by dropping. `isOver` is true only while a valid
 * drag hovers it, which the tile/row uses to paint its active affordance.
 */
export function useFolderDroppable(folderId: string) {
  const ctx = useContext(FileDndContext)
  const disabled = ctx ? ctx.blocked.has(folderId) : true
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${folderId}`,
    data: { folderId },
    disabled,
  })
  return { setNodeRef, isOver: isOver && !disabled }
}

/**
 * A folder is both a drag source (file it elsewhere) and a drop target (file
 * things into it), so it needs both refs merged onto its one root node.
 */
export function useFolderDragDrop(folder: {
  id: string
  name: string
  parentFolderId: string | null
}) {
  const {
    attributes,
    listeners,
    isDragging,
    setNodeRef: setDragRef,
  } = useFileDraggable({
    kind: "folder",
    id: folder.id,
    name: folder.name,
    currentParentId: folder.parentFolderId,
  })
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
 * Wraps the files content (folder section + canvas list) in a DndContext so a
 * drag started on any canvas/folder can drop onto any folder. On drop, resolves
 * the move with `planFileDrop` (the shared cycle guard) and commits it through
 * the home provider's `moveRoom` / `moveFolder` — the same server path the
 * dialog uses.
 */
export function FileDndProvider({ children }: { children: React.ReactNode }) {
  const { moveRoom, moveFolder, allFolders } = useHome()
  const [activeItem, setActiveItem] = useState<FileDragItem | null>(null)

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
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const item = activeItem
      setActiveItem(null)
      if (!item) return
      const targetId = event.over?.data.current?.folderId as string | undefined
      if (!targetId) return
      const plan = planFileDrop(item, targetId, allFolders)
      if (!plan) return
      // Fire-and-forget like the dialog's onMove; the provider patches local
      // state optimistically so the item leaves the view without a reload.
      if (plan.kind === "room") void moveRoom(plan.id, plan.targetId)
      else void moveFolder(plan.id, plan.targetId)
    },
    [activeItem, allFolders, moveRoom, moveFolder]
  )

  return (
    <FileDndContext.Provider value={{ activeItem, blocked }}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveItem(null)}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {activeItem ? <DragPreview item={activeItem} /> : null}
        </DragOverlay>
      </DndContext>
    </FileDndContext.Provider>
  )
}

// The floating preview under the cursor while dragging — a compact chip echoing
// the item's icon + name, matching the tile/row it was lifted from.
function DragPreview({ item }: { item: FileDragItem }) {
  const Icon = item.kind === "folder" ? FolderIcon : FileIcon
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5",
        "text-sm font-medium shadow-lg ring-1 ring-foreground/10"
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{item.name}</span>
    </div>
  )
}
