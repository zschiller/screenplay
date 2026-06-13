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
import type { FolderSummary } from "@/lib/folders-actions"

/**
 * Beyond this many ancestor crumbs (the chain root→current, current included),
 * the middle collapses into an overflow menu so a deep path can't push the
 * header past its width. Three keeps "All files › A › B › current" inline —
 * the deepest trail that still reads comfortably as a title — and only folds
 * once a fourth level appears.
 */
const MAX_INLINE_ANCESTORS = 3

/**
 * The files-header trail (PRD #475): an "All files" root crumb, a clickable link
 * per ancestor folder, then the current folder as the bold non-link last crumb.
 * `ancestors` is the chain root→current *including* the current folder, so an
 * empty list is the root view — where "All files" itself is the current page.
 * Sized to read like the page title it replaces.
 *
 * Deep paths (issue #485) collapse the *middle* into a `BreadcrumbEllipsis`
 * overflow menu: "All files" and the current folder always stay visible, and
 * every ancestor between them moves into the menu, each navigating to its level.
 */
export function FolderBreadcrumb({
  ancestors,
}: {
  ancestors: FolderSummary[]
}) {
  const atRoot = ancestors.length === 0
  const allFilesCrumb = (
    <BreadcrumbItem>
      {atRoot ? (
        <BreadcrumbPage className="text-2xl font-normal">
          All files
        </BreadcrumbPage>
      ) : (
        <BreadcrumbLink asChild>
          <Link href="/files">All files</Link>
        </BreadcrumbLink>
      )}
    </BreadcrumbItem>
  )

  // Past the threshold, keep only "All files" and the current folder inline and
  // tuck the ancestors between them behind the overflow menu.
  if (ancestors.length > MAX_INLINE_ANCESTORS) {
    const current = ancestors[ancestors.length - 1]!
    const collapsed = ancestors.slice(0, -1)
    return (
      <Breadcrumb>
        <BreadcrumbList className="gap-1.5 text-2xl font-normal sm:gap-2.5">
          {allFilesCrumb}
          <BreadcrumbSeparator className="[&>svg]:size-5" />
          <BreadcrumbItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Show folders in between"
                className="flex items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none data-[state=open]:text-foreground"
              >
                <BreadcrumbEllipsis className="size-7" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {collapsed.map((folder) => (
                  <DropdownMenuItem key={folder.id} asChild>
                    <Link href={`/files/${folder.id}`}>{folder.name}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="[&>svg]:size-5" />
          <BreadcrumbItem>
            <BreadcrumbPage className="text-2xl font-normal">
              {current.name}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  return (
    <Breadcrumb>
      <BreadcrumbList className="gap-1.5 text-2xl font-normal sm:gap-2.5">
        {allFilesCrumb}
        {ancestors.map((folder, i) => {
          const isCurrent = i === ancestors.length - 1
          return (
            <Fragment key={folder.id}>
              <BreadcrumbSeparator className="[&>svg]:size-5" />
              <BreadcrumbItem>
                {isCurrent ? (
                  <BreadcrumbPage className="text-2xl font-normal">
                    {folder.name}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={`/files/${folder.id}`}>{folder.name}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
