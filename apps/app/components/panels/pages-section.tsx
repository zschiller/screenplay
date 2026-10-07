"use client"

import { memo, useEffect, useRef, useState } from "react"
import { useDroppable } from "@dnd-kit/core"

import { PlusIcon } from "@workspace/ui/components/icons"
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
import type { PageData } from "@/lib/types"

/** One row's height, and the section's chrome around its rows (the label
 *  row plus the group's padding), for sizing the Pages panel. */
const PAGE_ROW_HEIGHT = 32
const PAGES_CHROME_HEIGHT = 48

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
}

/**
 * The left sidebar's Pages section (#1835): every page of the canvas, the
 * current one active. Click switches; + adds “Page N” and opens its name in
 * the inline rename field, where Enter commits, as in every inline rename.
 * A layer row dragged onto another page's row moves there (#1837).
 */
export const PagesSection = memo(function PagesSection({
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onRenamePage,
}: PagesSectionProps) {
  // The page just added, whose name opens for renaming once its row is in.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  return (
    <SidebarGroup data-sidebar-pages>
      <div className="flex items-center justify-between">
        <SidebarGroupLabel>Pages</SidebarGroupLabel>
        <IconButton
          label="New page"
          tooltipSide="right"
          className="-mr-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
          onClick={() => setRenamingId(onAddPage())}
        >
          <PlusIcon />
        </IconButton>
      </div>
      <SidebarMenu aria-label="Pages">
        {pages.map((page) => (
          <PageRow
            key={page.id}
            page={page}
            current={page.id === currentPageId}
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

function PageRow({
  page,
  current,
  renameOnMount,
  onRenameStarted,
  onSelect,
  onRename,
}: {
  page: PageData
  current: boolean
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
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
