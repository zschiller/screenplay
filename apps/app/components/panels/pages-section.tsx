"use client"

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useDroppable } from "@dnd-kit/core"

import { CaretRightIcon, PlusIcon } from "@workspace/ui/components/icons"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
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
}

/**
 * The left sidebar's Pages section (#1835): every page of the canvas, the
 * current one active. Click switches; + adds “Page N” and opens its name in
 * the inline rename field, where Enter commits, as in every inline rename.
 * A layer row dragged onto another page's row moves there (#1837). A row
 * ends in the avatars of the other people on that page (#1840). The heading
 * folds the list away and then reads as the current page's name.
 */
export const PagesSection = memo(function PagesSection({
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onRenamePage,
  open,
  onOpenChange,
}: PagesSectionProps) {
  // The page just added, whose name opens for renaming once its row is in.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const peopleByPage = usePeopleByPage(pages)
  const listId = useId()
  const currentName =
    pages.find((page) => page.id === currentPageId)?.name ?? ""
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
            renameOnMount={page.id === renamingId}
            onRenameStarted={() => setRenamingId(null)}
            onSelect={onSelectPage}
            onRename={onRenamePage}
          />
        ))}
      </SidebarMenu>
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

function PageRow({
  page,
  current,
  people,
  renameOnMount,
  onRenameStarted,
  onSelect,
  onRename,
}: {
  page: PageData
  current: boolean
  people: readonly PeerPresence[] | undefined
  renameOnMount: boolean
  onRenameStarted: () => void
  onSelect: (pageId: string) => void
  onRename: (pageId: string, name: string) => void
}) {
  const nameRef = useRef<EditableTextHandle | null>(null)
  useEffect(() => {
    if (!renameOnMount) return
    nameRef.current?.startEditing()
    onRenameStarted()
  }, [renameOnMount, onRenameStarted])
  // The current page isn't somewhere to move to.
  const { setNodeRef, isOver } = useDroppable({
    id: `${PAGE_DROP_PREFIX}${page.id}`,
    disabled: current,
  })
  return (
    <SidebarMenuItem
      ref={setNodeRef}
      data-drop-over={isOver || undefined}
      className={cn(isOver && "rounded-md ring-2 ring-canvas-selection")}
    >
      <SidebarMenuButton
        isActive={current}
        aria-current={current ? "page" : undefined}
        className="!transition-[width,height] has-[[data-editable-text=editing]]:overflow-visible"
        onClick={() => onSelect(page.id)}
        onKeyDown={(e) => renameOnF2(e, nameRef)}
      >
        <EditableText
          ref={nameRef}
          as="span"
          value={page.name}
          onCommit={(next) => onRename(page.id, next)}
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
    </SidebarMenuItem>
  )
}
