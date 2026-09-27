"use client"

import Link from "next/link"
import { cn } from "@workspace/ui/lib/utils"
import { useHome } from "./home-provider"

/**
 * Where a search result lives (#807): its folder trail from the root, as muted
 * text linking to that folder — "All files" for the root, otherwise "Design
 * system / Archive". The trail truncates from the end, so the outermost folder
 * stays readable in a narrow column.
 */
export function ResultLocation({
  folderId,
  className,
}: {
  /** The folder the result sits in; null = the root. */
  folderId: string | null
  className?: string
}) {
  const { folderPath } = useHome()
  const trail = folderPath(folderId)
  const label =
    trail.length === 0
      ? "All files"
      : trail.map((folder) => folder.name).join(" / ")
  return (
    <Link
      href={folderId ? `/files/${folderId}` : "/files"}
      title={label}
      className={cn(
        "block truncate text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {label}
    </Link>
  )
}
