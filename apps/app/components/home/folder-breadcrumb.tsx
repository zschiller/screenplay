"use client"

import { Fragment } from "react"
import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import type { FolderSummary } from "@/lib/folders-actions"
import { useFolderDroppable, useRootDroppable } from "./file-dnd"
import { useHomeHeaderCompact } from "./home-page-header"

/**
 * Beyond this many ancestor crumbs (the chain root→current, current included),
 * the middle collapses into an overflow menu so a deep path can't push the
 * header past its width. Three keeps "All files › A › B › current" inline —
 * the deepest trail that still reads comfortably as a title — and only folds
 * once a fourth level appears.
 */
const MAX_INLINE_ANCESTORS = 3

// The trail never wraps: it's the header's title, one line tall, and it shares
// the row with the toolbar. Instead every crumb can shrink and truncate — the
// ancestors ("All files" included) first, four times as fast, then the current
// folder, which keeps its leading characters to the last.
const LIST_CLASS = "min-w-0 flex-nowrap gap-1.5 text-2xl font-normal sm:gap-2.5"
const SEPARATOR_CLASS = "shrink-0 [&>svg]:size-5"
const ANCESTOR_ITEM_CLASS = "min-w-8 shrink-[4]"
const CURRENT_ITEM_CLASS = "min-w-0"
const CURRENT_PAGE_CLASS = "truncate text-2xl font-normal"
// A parent crumb is a drop target (issue #808): drop a canvas or folder on it
// to move the item up to that level. The hover ring matches the sidebar's drop
// targets; the padding it needs is cancelled by a matching negative margin so
// the trail doesn't shift.
const DROP_ITEM_CLASS = "-mx-1.5 -my-1 rounded-md px-1.5 py-1"
const DROP_OVER_CLASS = "ring-2 ring-primary [&_a]:text-foreground"

/**
 * The files-header trail (PRD #475): an "All files" root crumb, a clickable link
 * per ancestor folder, then the current folder as the bold non-link last crumb.
 * `ancestors` is the chain root→current *including* the current folder, so an
 * empty list is the root view — where "All files" itself is the current page.
 * Sized to read like the page title it replaces.
 *
 * Every crumb above the current folder is a drop target (issue #808), so a
 * canvas or folder dragged onto it moves up to that level.
 *
 * Deep paths (issue #485) collapse the *middle* into a `BreadcrumbEllipsis`
 * overflow menu: "All files" and the current folder always stay visible, and
 * every ancestor between them moves into the menu, each navigating to its level.
 *
 * In a compact header (a narrow window beside a wide sidebar) any folder below
 * the root collapses, and "All files" joins its ancestors in the menu: the trail
 * reads "… › current", so the crumb that names the page keeps the room.
 */
export function FolderBreadcrumb({
  ancestors,
}: {
  ancestors: FolderSummary[]
}) {
  const compact = useHomeHeaderCompact()
  const atRoot = ancestors.length === 0
  const allFilesCrumb = atRoot ? (
    <BreadcrumbItem className={CURRENT_ITEM_CLASS}>
      <BreadcrumbPage className={CURRENT_PAGE_CLASS}>All files</BreadcrumbPage>
    </BreadcrumbItem>
  ) : (
    <RootCrumb />
  )

  // Past the threshold, keep only "All files" and the current folder inline and
  // tuck the ancestors between them behind the overflow menu (compact: tuck
  // "All files" in too).
  if (compact ? !atRoot : ancestors.length > MAX_INLINE_ANCESTORS) {
    const current = ancestors[ancestors.length - 1]!
    const collapsed = ancestors.slice(0, -1)
    return (
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className={LIST_CLASS}>
          {!compact && (
            <>
              {allFilesCrumb}
              <BreadcrumbSeparator className={SEPARATOR_CLASS} />
            </>
          )}
          <BreadcrumbItem className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={
                  compact ? "Show parent folders" : "Show folders in between"
                }
                className="flex items-center rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:text-foreground"
              >
                <BreadcrumbEllipsis className="size-7" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {compact && (
                  <DropdownMenuItem asChild>
                    <Link href="/files">All files</Link>
                  </DropdownMenuItem>
                )}
                {collapsed.map((folder) => (
                  <DropdownMenuItem key={folder.id} asChild>
                    <Link href={`/files/${folder.id}`}>{folder.name}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </BreadcrumbItem>
          <BreadcrumbSeparator className={SEPARATOR_CLASS} />
          <BreadcrumbItem className={CURRENT_ITEM_CLASS}>
            <BreadcrumbPage className={CURRENT_PAGE_CLASS}>
              {current.name}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className={LIST_CLASS}>
        {allFilesCrumb}
        {ancestors.map((folder, i) => {
          const isCurrent = i === ancestors.length - 1
          return (
            <Fragment key={folder.id}>
              <BreadcrumbSeparator className={SEPARATOR_CLASS} />
              {isCurrent ? (
                <BreadcrumbItem className={CURRENT_ITEM_CLASS}>
                  <BreadcrumbPage className={CURRENT_PAGE_CLASS}>
                    {folder.name}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              ) : (
                <FolderCrumb folder={folder} />
              )}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** The "All files" crumb below the root: a link, and a drop target. */
function RootCrumb() {
  const { setNodeRef, isOver } = useRootDroppable("crumb")
  return (
    <BreadcrumbItem
      ref={setNodeRef}
      className={cn(
        ANCESTOR_ITEM_CLASS,
        DROP_ITEM_CLASS,
        isOver && DROP_OVER_CLASS
      )}
    >
      <BreadcrumbLink asChild>
        <Link href="/files" className="truncate">
          All files
        </Link>
      </BreadcrumbLink>
    </BreadcrumbItem>
  )
}

/** An ancestor folder's crumb: a link, and a drop target. */
function FolderCrumb({ folder }: { folder: FolderSummary }) {
  const { setNodeRef, isOver } = useFolderDroppable(folder.id, "crumb")
  return (
    <BreadcrumbItem
      ref={setNodeRef}
      className={cn(
        ANCESTOR_ITEM_CLASS,
        DROP_ITEM_CLASS,
        isOver && DROP_OVER_CLASS
      )}
    >
      <BreadcrumbLink asChild>
        <Link href={`/files/${folder.id}`} className="truncate">
          {folder.name}
        </Link>
      </BreadcrumbLink>
    </BreadcrumbItem>
  )
}
