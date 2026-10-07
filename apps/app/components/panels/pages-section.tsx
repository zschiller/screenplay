"use client"

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"

import {
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import {
  EditableText,
  editableTextFieldClass,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import { cn } from "@workspace/ui/lib/utils"

import { renameOnF2 } from "@/components/panels/layer-rows/rename-key"
import {
  frameRowActionClass,
  frameRowButtonClass,
} from "@/components/panels/layer-rows/row-action"
import { PagePeople, usePeopleByPage } from "@/components/panels/page-people"
import type { PageData } from "@/lib/types"
import type { PeerPresence } from "@/lib/yjs/react"

/** One row's height, and the section's chrome around its rows (the label
 *  row plus the group's padding), for sizing the Pages panel. */
const PAGE_ROW_HEIGHT = 32
const PAGES_CHROME_HEIGHT = 48

/** The Pages panel's height folded to its heading. */
export const PAGES_COLLAPSED_HEIGHT = PAGES_CHROME_HEIGHT

/** A page row's drop id: the sidebar's layer rows move to the page they're
 *  dropped on (#1837). */
export const PAGE_DROP_PREFIX = "page:"

/** The Pages panel's height showing `rows` page rows. */
export function pagesPanelHeight(rows: number): number {
  return PAGES_CHROME_HEIGHT + rows * PAGE_ROW_HEIGHT
}

export type PagesSectionProps = {
  pages: PageData[]
  currentPageId: string
  onSelectPage: (pageId: string) => void
  /** Adds a page, switches to it and returns its id, so its name opens for
   *  renaming. */
  onAddPage: () => string
  onRenamePage: (pageId: string, name: string) => void
  /** The list is showing; folded, the heading names the current page. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pages' new order after a row is dragged (#1836). */
  onReorderPages: (orderedIds: string[]) => void
  onDuplicatePage: (pageId: string) => void
  /** Offered only while there's more than one page. */
  onDeletePage: (pageId: string) => void
}

type PageRowActions = Pick<
  PagesSectionProps,
  "onRenamePage" | "onDuplicatePage" | "onDeletePage"
>

/**
 * The left sidebar's Pages section (#1835, #1836): every page of the canvas,
 * the current one active. Click switches; + adds “Page N” and opens its name
 * in the inline rename field, where Enter commits, as in every inline rename.
 * Double-click renames; a row drags to reorder; its ⋯ menu (or a right-click)
 * has Rename, Duplicate and Delete. A layer row dragged
 * onto another page's row moves there (#1837). A row ends in the avatars of
 * the other people on that page (#1840). The heading folds the list away and
 * then reads as the current page's name.
 *
 * Two drags meet on a row: reordering pages runs in this section's own
 * drag context, and a layer row's drop target lives in the sidebar's, so
 * each row's drop target is registered out here, above the inner context.
 */
export const PagesSection = memo(function PagesSection({
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onReorderPages,
  open,
  onOpenChange,
  ...actions
}: PagesSectionProps) {
  // Each page row's drop target in the sidebar's drag context (#1837), by
  // page id; the row hands it its element.
  const [dropRefs] = useState(
    () => new Map<string, (el: HTMLElement | null) => void>()
  )
  const layerOver = useDndContext().over?.id
  // The page just added, whose name opens for renaming once its row is in.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const sensors = useSensors(
    // A click (no movement) still switches page; a real drag past 6px moves.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks a row up; Enter on it switches page, as on the layer rows.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    })
  )
  const ids = pages.map((p) => p.id)
  const peopleByPage = usePeopleByPage(pages)
  const listId = useId()
  const currentName =
    pages.find((page) => page.id === currentPageId)?.name ?? ""
  // The click that ends a drag doesn't also switch to the dragged page.
  const draggingRef = useRef(false)
  const endDrag = () => {
    setTimeout(() => {
      draggingRef.current = false
    })
  }
  const selectPage = (pageId: string) => {
    if (!draggingRef.current) onSelectPage(pageId)
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag()
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorderPages(arrayMove(ids, from, to))
  }
  return (
    <SidebarGroup data-sidebar-pages data-state={open ? "open" : "closed"}>
      <div className="flex items-center justify-between gap-2">
        <PagesHeading
          open={open}
          currentName={currentName}
          listId={listId}
          onToggle={() => onOpenChange(!open)}
        />
        <IconButton
          label="New page"
          tooltipSide="right"
          className="-mr-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
          onClick={() => {
            onOpenChange(true)
            setRenamingId(onAddPage())
          }}
        >
          <PlusIcon />
        </IconButton>
      </div>
      {pages.map((page) => (
        <PageDropTarget
          key={page.id}
          pageId={page.id}
          disabled={page.id === currentPageId}
          refs={dropRefs}
        />
      ))}
      <DndContext
        // Stable id keeps dnd-kit's a11y `aria-describedby` deterministic
        // across SSR/hydration.
        id="room-sidebar-pages"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          draggingRef.current = true
        }}
        onDragCancel={endDrag}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <SidebarMenu
            id={listId}
            aria-label="Pages"
            inert={!open}
            className={cn(
              "transition-opacity duration-200 ease-out motion-reduce:transition-none",
              !open && "opacity-0"
            )}
          >
            {pages.map((page) => (
              <PageRow
                key={page.id}
                page={page}
                current={page.id === currentPageId}
                people={peopleByPage.get(page.id)}
                canDelete={pages.length > 1}
                dropRef={dropRefs.get(page.id)}
                dropOver={layerOver === `${PAGE_DROP_PREFIX}${page.id}`}
                renameOnMount={page.id === renamingId}
                onRenameStarted={() => setRenamingId(null)}
                onSelect={selectPage}
                {...actions}
              />
            ))}
          </SidebarMenu>
        </SortableContext>
      </DndContext>
    </SidebarGroup>
  )
})

/** The heading's two texts swap: the outgoing one goes quickly, then the
 *  incoming one comes in, so they never sit on top of each other. */
function fade(shown: boolean) {
  return cn(
    "transition-opacity ease-out motion-reduce:transition-none",
    shown ? "opacity-100 delay-75 duration-150" : "opacity-0 duration-75"
  )
}

/**
 * The section's heading, which folds the list: “Pages” while it shows, the
 * current page's name once folded (Figma's folded Pages section). The two
 * cross-fade in one cell whose width follows the one showing, so the caret
 * slides with it rather than jumping.
 */
function PagesHeading({
  open,
  currentName,
  listId,
  onToggle,
}: {
  open: boolean
  currentName: string
  listId: string
  onToggle: () => void
}) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    // scrollWidth: the text's own width, even while the name is cut short.
    // It's rounded to whole pixels, so one more keeps the text from clipping.
    const shown = open ? labelRef.current : nameRef.current
    if (shown) setWidth(shown.scrollWidth + 1)
  }, [open, currentName])
  return (
    <SidebarGroupLabel asChild>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        className="min-w-0 gap-1 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground"
        onClick={onToggle}
      >
        <span
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width }}
        >
          <span
            ref={labelRef}
            aria-hidden={!open}
            className={cn(
              "col-start-1 row-start-1 max-w-full self-center justify-self-start overflow-hidden whitespace-nowrap",
              fade(open)
            )}
          >
            Pages
          </span>
          <span
            ref={nameRef}
            aria-hidden={open}
            className={cn(
              "col-start-1 row-start-1 max-w-full self-center justify-self-start truncate font-sans text-sm font-medium tracking-normal text-sidebar-foreground normal-case font-stretch-[98.8%]",
              fade(!open)
            )}
          >
            {currentName}
          </span>
        </span>
        {/* Turned about its ink's centre, as on the Chats menu's Done. */}
        <CaretRightIcon
          className={cn(
            "!size-3 origin-[53.125%_50%] transition-transform duration-200 ease-out motion-reduce:transition-none",
            open && "rotate-90"
          )}
        />
      </button>
    </SidebarGroupLabel>
  )
}

/** A page row's drop target for layer rows (#1837), in the sidebar's drag
 *  context; the current page isn't somewhere to move to. */
function PageDropTarget({
  pageId,
  disabled,
  refs,
}: {
  pageId: string
  disabled: boolean
  refs: Map<string, (el: HTMLElement | null) => void>
}) {
  const { setNodeRef } = useDroppable({
    id: `${PAGE_DROP_PREFIX}${pageId}`,
    disabled,
  })
  refs.set(pageId, setNodeRef)
  useEffect(() => () => void refs.delete(pageId), [refs, pageId])
  return null
}

function PageRow({
  page,
  current,
  people,
  canDelete,
  dropRef,
  dropOver,
  renameOnMount,
  onRenameStarted,
  onSelect,
  onRenamePage,
  onDuplicatePage,
  onDeletePage,
}: {
  page: PageData
  current: boolean
  people: readonly PeerPresence[] | undefined
  canDelete: boolean
  /** The row's drop target for layer rows (#1837), and whether one is over it. */
  dropRef?: (el: HTMLElement | null) => void
  dropOver: boolean
  renameOnMount: boolean
  onRenameStarted: () => void
  onSelect: (pageId: string) => void
} & PageRowActions) {
  const nameRef = useRef<EditableTextHandle | null>(null)
  useEffect(() => {
    if (!renameOnMount) return
    nameRef.current?.startEditing()
    onRenameStarted()
  }, [renameOnMount, onRenameStarted])
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id })
  // A right-click opens the row's ⋯ menu.
  const [menuOpen, setMenuOpen] = useState(false)
  // Rename waits for the menu to close: its focus trap would take focus back
  // from the inline field.
  const renamePendingRef = useRef(false)
  return (
    <SidebarMenuItem
      ref={(el) => {
        setNodeRef(el)
        dropRef?.(el)
      }}
      data-drop-over={dropOver || undefined}
      className={cn(
        "group/frame-row",
        isDragging && "z-10",
        dropOver && "rounded-md ring-2 ring-canvas-selection"
      )}
      style={{
        transform: transform
          ? `translate3d(0, ${transform.y}px, 0)`
          : undefined,
        transition,
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuOpen(true)
      }}
    >
      <SidebarMenuButton
        ref={setActivatorNodeRef}
        isActive={current}
        aria-current={current ? "page" : undefined}
        className={cn(
          "!transition-[width,height] has-[[data-editable-text=editing]]:overflow-visible",
          frameRowButtonClass
        )}
        {...attributes}
        {...listeners}
        // The row's button is its one Tab stop, not the sortable's wrapper.
        role={undefined}
        onClick={() => onSelect(page.id)}
        onKeyDown={(e) => {
          renameOnF2(e, nameRef)
          listeners?.onKeyDown?.(e)
        }}
      >
        <EditableText
          ref={nameRef}
          as="span"
          value={page.name}
          onCommit={(next) => onRenamePage(page.id, next)}
          placeholder="Page"
          tabIndex={-1}
          className="min-w-0"
          viewClassName="truncate"
          editClassName={cn(
            editableTextFieldClass,
            "-mx-0.5 -my-0.5 min-w-0 px-0.5 py-0.5"
          )}
        />
        {people ? <PagePeople people={people} /> : null}
      </SidebarMenuButton>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton label="Page options" tooltipSide="right" asChild>
            <SidebarMenuAction className={frameRowActionClass}>
              <DotsThreeIcon />
            </SidebarMenuAction>
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          onCloseAutoFocus={(e) => {
            if (!renamePendingRef.current) return
            renamePendingRef.current = false
            e.preventDefault()
            nameRef.current?.startEditing()
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              renamePendingRef.current = true
            }}
          >
            <PencilSimpleIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDuplicatePage(page.id)}>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            onSelect={() => onDeletePage(page.id)}
          >
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
