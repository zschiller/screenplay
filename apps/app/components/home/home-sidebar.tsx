"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  ChevronRight,
  ChevronsUpDown,
  File as FileIcon,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
} from "lucide-react"
import { signOut, useAppSession } from "@/lib/auth-client"
import { isLocalBuild } from "@/lib/local-mode"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { DRAFTS_FOLDER_ID } from "@/lib/organization"
import { useHome, ALL_VIEW_ID } from "./home-provider"
import { InputDialog } from "./file-dialogs"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { FileActionMenu } from "./file-action-menu"
import { FolderActionMenu } from "./folder-action-menu"
import { RepoConfigsDialog } from "./repo-configs-dialog"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { Folder as FolderType } from "@/lib/organization"

/*
 * Drag-and-drop for the Folders section, ported from the room sidebar
 * (components/panels/room-sidebar.tsx) so both sidebars share one
 * interaction language: pointer-driven collision (no dragged-rect
 * hysteresis), a single parent-computed drop hint (fuchsia line between
 * rows, ring for "drop into"), thin gap strips for top-level reorder, the
 * floating preview in a <DragOverlay>, and a 6px activation distance so
 * plain clicks pass through to selection/navigation.
 *
 * Folders ≙ groups: they reorder only by landing in the gap strips between
 * folders. Files ≙ members: they reorder among siblings (line), move into
 * another folder (ring on its header), or move back to Drafts (ring on the
 * Drafts row).
 */

/** One draggable row in the Folders section. */
type HomeDragRow =
  | { kind: "folder"; folder: FolderType }
  | { kind: "file"; file: RoomSummary; folderId: string }

function rowId(row: HomeDragRow): string {
  return row.kind === "folder"
    ? `folder:${row.folder.id}`
    : `file:${row.file.id}`
}

/** Droppable id of the Drafts row — files dropped here leave their folder. */
const DRAFTS_DROP_ID = "drafts-drop"

/**
 * Which edge of `rect` a drop lands on — purely from the live POINTER Y vs
 * the row's vertical midpoint, never the drag direction or the dragged
 * item's center, so a given pixel always resolves to the same edge.
 */
function pointerSide(rect: ClientRect, pointerY: number): "before" | "after" {
  return pointerY < rect.top + rect.height / 2 ? "before" : "after"
}

/**
 * The single drop indicator for the whole Folders section, computed once by
 * the parent on each drag move and read by every {@link SortableRow}.
 * Exactly one row matches at a time, so a given gap is always painted at one
 * pixel and the line can't flicker between adjacent rows.
 */
type DropHint =
  | { kind: "into"; rowId: string }
  | { kind: "line"; rowId: string; edge: "before" | "after" }

const DropHintContext = createContext<DropHint | null>(null)

function sameDropHint(a: DropHint | null, b: DropHint | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind || a.rowId !== b.rowId) return false
  return a.kind === "line" && b.kind === "line" ? a.edge === b.edge : true
}

/**
 * Fully pointer-driven collision (mirrors the room sidebar's
 * canvasCollision): the eligible row/strip the cursor is over, or — in the
 * dead space between rows — the one it's vertically closest to. Folder drags
 * are restricted to the `foldergap:` strips so the gap line is the single
 * source of truth; file drags land on file rows, folder headers, or the
 * Drafts row.
 */
const homeCollision: CollisionDetection = (args) => {
  const draggingFolder =
    (args.active.data.current as { kind?: string } | undefined)?.kind ===
    "folder"
  const eligible = (id: string | number) => {
    const s = String(id)
    if (draggingFolder) return s.startsWith("foldergap:")
    return (
      s.startsWith("file:") || s.startsWith("folder:") || s === DRAFTS_DROP_ID
    )
  }

  const within = pointerWithin(args).filter((c) => eligible(c.id))
  if (within.length > 0) return within

  const y = args.pointerCoordinates?.y
  let best: { id: string | number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  if (y != null) {
    for (const container of args.droppableContainers) {
      if (!eligible(container.id)) continue
      const rect = args.droppableRects.get(container.id)
      if (!rect) continue
      const dist =
        y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      if (dist < bestDist) {
        bestDist = dist
        best = { id: container.id }
      }
    }
  }
  if (best) return [best]
  return closestCenter(args).filter((c) => eligible(c.id))
}

/**
 * Move `activeId` to the `before`/`after` side of `overId` within `ids`.
 * Driven purely by the resolved side (not arrayMove's index math), so the
 * commit lands exactly where the indicator pointed. Works for cross-folder
 * inserts too — `activeId` simply isn't in `ids` yet.
 */
function reorderToSide(
  ids: readonly string[],
  activeId: string,
  overId: string,
  after: boolean
): string[] {
  const without = ids.filter((x) => x !== activeId)
  let idx = without.indexOf(overId)
  if (idx < 0) return [...ids]
  if (after) idx += 1
  without.splice(idx, 0, activeId)
  return without
}

/**
 * The single canonical drop indicator — a 2px fuchsia line, the same visual
 * the room sidebar and canvas use for the active target. `offsetPx` tunes the
 * line to sit in the middle of the gap to the neighbouring row.
 */
function DropLine({
  side,
  offsetPx = 1,
}: {
  side: "before" | "after"
  offsetPx?: number
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-fuchsia-500"
      style={side === "before" ? { top: -offsetPx } : { bottom: -offsetPx }}
    />
  )
}

/**
 * Droppable strip between (and around) folders. Fixed thin height regardless
 * of drag state so hovering it doesn't shove the list around — the cursor
 * drives `isOver`, which lights the strip up as the reorder indicator.
 */
function FolderGap({ index }: { index: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `foldergap:${index}` })
  return (
    <li ref={setNodeRef} aria-hidden className="relative -my-px h-1">
      {isOver ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-fuchsia-500" />
      ) : null}
    </li>
  )
}

/**
 * A row wired into dnd-kit's sortable context. Like the room sidebar, we
 * intentionally DON'T apply `useSortable`'s transform/transition — the
 * strategy assumes a flat equal-height list, and this one mixes folder
 * headers with indented file rows. The dragged source goes opacity 0, the
 * cursor preview is rendered by <DragOverlay>, and the drop indicator is
 * driven by the single parent-computed {@link DropHint}.
 */
function SortableRow({
  id,
  kind,
  folderId,
  dropLineOffsetPx = 1,
  className,
  children,
}: {
  id: string
  kind: HomeDragRow["kind"]
  /** Owning folder, for file rows — lets drag handlers tell same-folder
   *  reorders from cross-folder moves. */
  folderId?: string
  dropLineOffsetPx?: number
  className?: string
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id,
    data: { kind, folderId },
  })
  const hint = useContext(DropHintContext)
  const indicator: "before" | "after" | "into" | null =
    hint && hint.rowId === id
      ? hint.kind === "into"
        ? "into"
        : hint.edge
      : null
  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn(
        "relative",
        // `ring` (not inset) so it sits OUTSIDE the row and stays visible
        // over the row's own hover/active styling.
        indicator === "into" && "z-10 rounded-md ring-2 ring-fuchsia-500",
        className
      )}
      {...attributes}
      {...listeners}
    >
      {children}
      {indicator === "before" || indicator === "after" ? (
        <DropLine side={indicator} offsetPx={dropLineOffsetPx} />
      ) : null}
    </div>
  )
}

/**
 * Makes the Drafts row a drop target: dropping a file here unfiles it (back
 * to Drafts), the home analogue of extracting a member from a canvas group.
 */
function DraftsDropTarget({ children }: { children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({
    id: DRAFTS_DROP_ID,
    data: { kind: "drafts" },
  })
  const hint = useContext(DropHintContext)
  const isInto = hint?.kind === "into" && hint.rowId === DRAFTS_DROP_ID
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative",
        isInto && "z-10 rounded-md ring-2 ring-fuchsia-500"
      )}
    >
      {children}
    </div>
  )
}

function UserHeader() {
  const { data: session, isPending } = useAppSession()
  const router = useRouter()
  const [configsOpen, setConfigsOpen] = useState(false)

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    )
  }

  const user = session?.user
  const name = user?.name ?? "Account"
  const email = user?.email ?? null
  const initials = (name[0] ?? "?").toUpperCase()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar className="size-7 rounded-md">
              <AvatarImage src={user?.image ?? undefined} alt={name} />
              <AvatarFallback className="rounded-md text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{name}</span>
              {email && (
                <span className="truncate text-xs text-muted-foreground">
                  {email}
                </span>
              )}
            </div>
            <ChevronsUpDown className="ml-auto size-4 opacity-60" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom">
          <DropdownMenuLabel className="text-muted-foreground">
            {isLocalBuild ? name : `Signed in as ${email ?? name}`}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfigsOpen(true)}>
            <LayoutGrid />
            Configured repositories
          </DropdownMenuItem>
          {/* No sign-out in the local build — there is no login (PRD #404). */}
          {!isLocalBuild && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await signOut()
                  router.push("/sign-in")
                }}
              >
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RepoConfigsDialog open={configsOpen} onOpenChange={setConfigsOpen} />
    </>
  )
}

function SidebarFileItem({
  file,
  folderId,
}: {
  file: RoomSummary
  folderId: string
}) {
  const { renameFile, removeFile } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <SidebarMenuSubItem>
      {/* The dialogs stay SIBLINGS of the sortable row (not children) so the
          KeyboardSensor's listeners never see keystrokes bubbling out of a
          portaled dialog input. */}
      <SortableRow
        id={`file:${file.id}`}
        kind="file"
        folderId={folderId}
        // file rows sit in a 4px `gap-1` sub-list — center the line in it.
        dropLineOffsetPx={3}
        className="group/sub-row cursor-grab active:cursor-grabbing"
      >
        <SidebarMenuSubButton asChild>
          <Link href={`/${file.id}`} draggable={false}>
            <FileIcon />
            <span>{file.name}</span>
          </Link>
        </SidebarMenuSubButton>
        <FileActionMenu
          file={file}
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onShare={() => setShareOpen(true)}
        >
          <SidebarMenuAction className="group-focus-within/sub-row:opacity-100 group-hover/sub-row:opacity-100 aria-expanded:opacity-100 md:opacity-0">
            <MoreHorizontal />
          </SidebarMenuAction>
        </FileActionMenu>
      </SortableRow>
      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename file"
        initialValue={file.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFile(file.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareRoomDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          roomId={file.id}
          roomName={file.name}
        />
      )}
    </SidebarMenuSubItem>
  )
}

function SidebarFolderItem({
  folder,
  isDragSource,
}: {
  folder: FolderType
  /** This folder is the active drag — hide the whole item (header AND
   *  children); the floating preview lives in the DragOverlay. */
  isDragSource: boolean
}) {
  const {
    filesInFolder,
    selectedId,
    setSelectedId,
    renameFolder,
    removeFolder,
    openFolders,
    setFolderOpen,
  } = useHome()
  // Open state lives in OrganizationState (per user, server-side), not
  // localStorage: the desktop dev server changes port — and therefore
  // localStorage origin — on every restart, which silently forgot it.
  const open = openFolders.has(folder.id)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const files = filesInFolder(folder.id)
  const isActive = selectedId === folder.id

  const updateOpen = useCallback(
    (next: boolean) => {
      void setFolderOpen(folder.id, next)
    },
    [folder.id, setFolderOpen]
  )

  return (
    <Collapsible open={open} onOpenChange={updateOpen} asChild>
      <SidebarMenuItem style={isDragSource ? { opacity: 0 } : undefined}>
        <SortableRow
          id={`folder:${folder.id}`}
          kind="folder"
          className="group/folder-row cursor-grab active:cursor-grabbing"
        >
          <SidebarMenuButton
            isActive={isActive}
            onClick={() => {
              setSelectedId(folder.id)
              updateOpen(true)
            }}
          >
            <span className="relative shrink-0">
              <FolderIcon className="block group-hover/folder-row:hidden" />
              <ChevronRight
                onClick={(e) => {
                  e.stopPropagation()
                  updateOpen(!open)
                }}
                className={`hidden size-4 cursor-pointer text-muted-foreground transition-transform group-hover/folder-row:block ${
                  open ? "rotate-90" : ""
                }`}
              />
            </span>
            <span>{folder.name}</span>
          </SidebarMenuButton>
          <FolderActionMenu
            folder={folder}
            onRename={() => setRenameOpen(true)}
            onDelete={() => setDeleteOpen(true)}
          >
            <SidebarMenuAction className="group-focus-within/folder-row:opacity-100 group-hover/folder-row:opacity-100 aria-expanded:opacity-100 md:opacity-0">
              <MoreHorizontal />
            </SidebarMenuAction>
          </FolderActionMenu>
        </SortableRow>
        {files.length > 0 && (
          <CollapsibleContent>
            <SidebarMenuSub>
              {files.map((file) => (
                <SidebarFileItem
                  key={file.id}
                  file={file}
                  folderId={folder.id}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        )}
        <InputDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title="Rename folder"
          initialValue={folder.name}
          submitLabel="Save"
          submittingLabel="Saving…"
          onSubmit={(name) => renameFolder(folder.id, name)}
        />
        <DeleteRoomDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          roomName={folder.name}
          onConfirm={async () => {
            await removeFolder(folder.id)
            setDeleteOpen(false)
          }}
        />
      </SidebarMenuItem>
    </Collapsible>
  )
}

function PinnedFolderItem({ folder }: { folder: FolderType }) {
  const { selectedId, setSelectedId, renameFolder, removeFolder } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={selectedId === folder.id}
        onClick={() => setSelectedId(folder.id)}
      >
        <FolderIcon />
        <span>{folder.name}</span>
      </SidebarMenuButton>
      <FolderActionMenu
        folder={folder}
        onRename={() => setRenameOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      >
        <SidebarMenuAction showOnHover>
          <MoreHorizontal />
        </SidebarMenuAction>
      </FolderActionMenu>
      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename folder"
        initialValue={folder.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFolder(folder.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={folder.name}
        onConfirm={async () => {
          await removeFolder(folder.id)
          setDeleteOpen(false)
        }}
      />
    </SidebarMenuItem>
  )
}

function PinnedFileItem({ file }: { file: RoomSummary }) {
  const { renameFile, removeFile } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href={`/${file.id}`}>
          <FileIcon />
          <span>{file.name}</span>
        </Link>
      </SidebarMenuButton>
      <FileActionMenu
        file={file}
        onRename={() => setRenameOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onShare={() => setShareOpen(true)}
      >
        <SidebarMenuAction showOnHover>
          <MoreHorizontal />
        </SidebarMenuAction>
      </FileActionMenu>
      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename file"
        initialValue={file.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFile(file.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareRoomDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          roomId={file.id}
          roomName={file.name}
        />
      )}
    </SidebarMenuItem>
  )
}

export function HomeSidebar() {
  const {
    folders,
    files,
    pinnedFiles,
    pinnedFolders,
    selectedId,
    setSelectedId,
    createFolder,
    loading,
    filesInFolder,
    moveFile,
    reorderFolders,
    reorderFilesInFolder,
  } = useHome()
  const [newFolderOpen, setNewFolderOpen] = useState(false)

  const pinnedFolderList = folders.filter((f) => pinnedFolders.has(f.id))
  const pinnedFileList = files.filter((f) => pinnedFiles.has(f.id))
  const hasPinned = pinnedFolderList.length + pinnedFileList.length > 0

  // --- Folders-section drag (see the primitives block up top) ---

  const sensors = useSensors(
    // Activation distance lets plain clicks through to selection/navigation;
    // any real drag past 6px starts moving.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /** One entry per draggable row, in display order — drives the
   *  SortableContext, drop-hint normalization, and overlay lookups. */
  const flattenedRows = useMemo<HomeDragRow[]>(() => {
    const rows: HomeDragRow[] = []
    for (const folder of folders) {
      rows.push({ kind: "folder", folder })
      for (const file of filesInFolder(folder.id)) {
        rows.push({ kind: "file", file, folderId: folder.id })
      }
    }
    return rows
  }, [folders, filesInFolder])

  const sortableIds = useMemo(() => flattenedRows.map(rowId), [flattenedRows])

  const [activeDragRow, setActiveDragRow] = useState<HomeDragRow | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  // Live pointer Y. dnd-kit's move events don't carry the pointer, so we
  // track it ourselves while a drag is active.
  const pointerYRef = useRef(0)
  const handlePointerMove = useCallback((e: PointerEvent) => {
    pointerYRef.current = e.clientY
  }, [])
  // After a real drag, the browser still fires a click on the source row —
  // which here would NAVIGATE (file rows are links). Swallow exactly that
  // one click in the capture phase.
  const suppressClickRef = useRef(false)
  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const row = flattenedRows.find(
        (r) => rowId(r) === String(event.active.id)
      )
      setActiveDragRow(row ?? null)
      const ae = event.activatorEvent as { clientY?: number }
      if (typeof ae.clientY === "number") pointerYRef.current = ae.clientY
      window.addEventListener("pointermove", handlePointerMove)
    },
    [flattenedRows, handlePointerMove]
  )

  const endDrag = useCallback(() => {
    window.removeEventListener("pointermove", handlePointerMove)
    setActiveDragRow(null)
    setDropHint(null)
    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }, [handlePointerMove])

  /**
   * The one canonical hint for the current pointer position. `before`/`after`
   * comes purely from the pointer vs the over row's midpoint; an `after` on a
   * file is normalized to `before` the next file in the SAME folder so a
   * given gap always renders at one fixed pixel.
   */
  const computeDropHint = useCallback(
    (
      activeRow: HomeDragRow,
      overId: string,
      overRect: ClientRect,
      pointerY: number
    ): DropHint | null => {
      // Folder drags resolve to gap strips (see homeCollision), which paint
      // their own indicator — never a row hint.
      if (activeRow.kind !== "file") return null
      if (overId === DRAFTS_DROP_ID) {
        return { kind: "into", rowId: overId }
      }
      if (overId.startsWith("folder:")) {
        // The file's own folder isn't a target — nothing to show.
        return overId.slice(7) === activeRow.folderId
          ? null
          : { kind: "into", rowId: overId }
      }
      if (!overId.startsWith("file:")) return null
      const edge = pointerSide(overRect, pointerY)
      if (edge === "after") {
        const idx = flattenedRows.findIndex((r) => rowId(r) === overId)
        const overRow = flattenedRows[idx]
        const next = flattenedRows[idx + 1]
        if (
          overRow?.kind === "file" &&
          next?.kind === "file" &&
          next.folderId === overRow.folderId
        ) {
          return { kind: "line", rowId: rowId(next), edge: "before" }
        }
      }
      return { kind: "line", rowId: overId, edge }
    },
    [flattenedRows]
  )

  // onDragMove (not onDragOver): the latter only fires when the `over` row
  // CHANGES, so the before/after edge wouldn't flip as the pointer crosses a
  // row's own midpoint.
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over } = event
      const activeRow =
        over && String(active.id) !== String(over.id)
          ? flattenedRows.find((r) => rowId(r) === String(active.id))
          : undefined
      const next =
        activeRow && over
          ? computeDropHint(
              activeRow,
              String(over.id),
              over.rect,
              pointerYRef.current
            )
          : null
      setDropHint((prev) => (sameDropHint(prev, next) ? prev : next))
    },
    [flattenedRows, computeDropHint]
  )

  /**
   * Slot a folder into the list at gap index `gapIndex` (0 = before first,
   * N = after last), accounting for the folder's own removal so a
   * `foldergap:N` drop maps straight through.
   */
  const reorderFolderToGap = useCallback(
    (folderId: string, gapIndex: number) => {
      const currentIds = folders.map((f) => f.id)
      const currentIdx = currentIds.indexOf(folderId)
      if (currentIdx < 0) return
      let target = gapIndex
      if (currentIdx < gapIndex) target -= 1
      const without = currentIds.filter((_, i) => i !== currentIdx)
      const clamped = Math.max(0, Math.min(target, without.length))
      const newOrder = [
        ...without.slice(0, clamped),
        folderId,
        ...without.slice(clamped),
      ]
      if (newOrder.join(",") === currentIds.join(",")) return
      void reorderFolders(newOrder)
    },
    [folders, reorderFolders]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const pointerY = pointerYRef.current
      endDrag()
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return
      const activeRow = flattenedRows.find((r) => rowId(r) === activeId)
      if (!activeRow) return

      // Folder reorder — only via the gap strips between folders.
      if (activeRow.kind === "folder") {
        if (!overId.startsWith("foldergap:")) return
        reorderFolderToGap(
          activeRow.folder.id,
          Number(overId.slice("foldergap:".length))
        )
        return
      }

      const fileId = activeRow.file.id

      // Back to Drafts — unfile.
      if (overId === DRAFTS_DROP_ID) {
        void moveFile(fileId, DRAFTS_FOLDER_ID)
        return
      }

      // Onto a folder header — move into that folder, after its files.
      if (overId.startsWith("folder:")) {
        const folderId = overId.slice(7)
        if (folderId === activeRow.folderId) return
        const targetIds = filesInFolder(folderId).map((f) => f.id)
        void moveFile(fileId, folderId, [...targetIds, fileId])
        return
      }

      // Adjacent to another file — same-folder reorder or cross-folder
      // insert at the indicated position. before/after comes from the live
      // pointer vs the over row's midpoint, the exact rule the drop hint
      // used, so the commit lands where the indicator pointed.
      if (!overId.startsWith("file:")) return
      const overRow = flattenedRows.find((r) => rowId(r) === overId)
      if (!overRow || overRow.kind !== "file") return
      const targetFolderId = overRow.folderId
      const currentIds = filesInFolder(targetFolderId).map((f) => f.id)
      const after = pointerSide(over.rect, pointerY) === "after"
      const newOrder = reorderToSide(currentIds, fileId, overRow.file.id, after)
      if (targetFolderId === activeRow.folderId) {
        if (newOrder.join(",") !== currentIds.join(","))
          void reorderFilesInFolder(targetFolderId, newOrder)
      } else {
        void moveFile(fileId, targetFolderId, newOrder)
      }
    },
    [
      flattenedRows,
      filesInFolder,
      moveFile,
      reorderFilesInFolder,
      reorderFolderToGap,
      endDrag,
    ]
  )

  return (
    <SidebarProvider className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserHeader />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent onClickCapture={handleClickCapture}>
        <DndContext
          sensors={sensors}
          collisionDetection={homeCollision}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={endDrag}
        >
          <DropHintContext.Provider value={dropHint}>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={selectedId === ALL_VIEW_ID}
                      onClick={() => setSelectedId(ALL_VIEW_ID)}
                    >
                      <LayoutGrid />
                      <span>All files</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <DraftsDropTarget>
                      <SidebarMenuButton
                        isActive={selectedId === DRAFTS_FOLDER_ID}
                        onClick={() => setSelectedId(DRAFTS_FOLDER_ID)}
                      >
                        <FileText />
                        <span>Drafts</span>
                      </SidebarMenuButton>
                    </DraftsDropTarget>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {hasPinned && (
              <SidebarGroup>
                <SidebarGroupLabel>Pinned</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {pinnedFolderList.map((folder) => (
                      <PinnedFolderItem key={folder.id} folder={folder} />
                    ))}
                    {pinnedFileList.map((file) => (
                      <PinnedFileItem key={file.id} file={file} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            <SidebarGroup>
              <SidebarGroupLabel>Folders</SidebarGroupLabel>
              <SidebarGroupAction
                title="New folder"
                onClick={() => setNewFolderOpen(true)}
              >
                <FolderPlus />
                <span className="sr-only">New folder</span>
              </SidebarGroupAction>
              <SidebarGroupContent>
                <SortableContext
                  items={sortableIds}
                  strategy={verticalListSortingStrategy}
                >
                  <SidebarMenu>
                    {folders.map((folder, folderIdx) => (
                      <Fragment key={folder.id}>
                        <FolderGap index={folderIdx} />
                        <SidebarFolderItem
                          folder={folder}
                          isDragSource={
                            activeDragRow?.kind === "folder" &&
                            activeDragRow.folder.id === folder.id
                          }
                        />
                      </Fragment>
                    ))}
                    <FolderGap index={folders.length} />
                    {loading && (
                      <SidebarMenuItem>
                        <div className="px-2 py-1.5">
                          <Skeleton className="h-4 w-24" />
                        </div>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenu>
                </SortableContext>
              </SidebarGroupContent>
            </SidebarGroup>
          </DropHintContext.Provider>
          <DragOverlay dropAnimation={null}>
            {activeDragRow ? (
              <div className="rounded-md bg-sidebar opacity-95 shadow-lg ring-1 ring-sidebar-border">
                {activeDragRow.kind === "folder" ? (
                  <SidebarMenuButton>
                    <FolderIcon />
                    <span className="truncate">
                      {activeDragRow.folder.name}
                    </span>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuSubButton asChild>
                    <div>
                      <FileIcon />
                      <span className="truncate">
                        {activeDragRow.file.name}
                      </span>
                    </div>
                  </SidebarMenuSubButton>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </SidebarContent>

      <InputDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title="New folder"
        description="Group related files together."
        placeholder="Folder name"
        submitLabel="Create"
        submittingLabel="Creating…"
        onSubmit={async (name) => {
          await createFolder(name)
        }}
      />
    </SidebarProvider>
  )
}
