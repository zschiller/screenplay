"use client"

import { Fragment } from "react"
import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import type { FolderSummary } from "@/lib/folders-actions"

/**
 * The files-header trail (PRD #475): an "All files" root crumb, a clickable link
 * per ancestor folder, then the current folder as the bold non-link last crumb.
 * `ancestors` is the chain root→current *including* the current folder, so an
 * empty list is the root view — where "All files" itself is the current page.
 * Sized to read like the page title it replaces.
 */
export function FolderBreadcrumb({
  ancestors,
}: {
  ancestors: FolderSummary[]
}) {
  const atRoot = ancestors.length === 0
  return (
    <Breadcrumb>
      <BreadcrumbList className="gap-1.5 text-2xl font-normal sm:gap-2.5">
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
