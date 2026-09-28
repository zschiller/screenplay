"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { Plus } from "lucide-react"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import {
  Empty,
  EmptyDescription,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { BranchBadge } from "@/components/branch-badge"
import { WorkspaceStatusIcon } from "@/components/panels/workspace-status-icon"
import type { StatusLineContext } from "@/lib/branch/status-line"
import type { BranchData, RepoData } from "@/lib/types"

/** No-op for the status icon's failure card: failed Workspaces aren't listed. */
const noop = () => {}

export interface UnassignedFramePickerProps {
  /** Every Workspace in the room; the picker lists the ones a frame can show. */
  branches: BranchData[]
  /** The Projects in the room, one New workspace entry each. */
  repos: RepoData[]
  /** The same status facts the sidebar reads (agent working, PR). */
  statusContext: (branchId: string) => StatusLineContext
  onAssign: (branchId: string) => void
  onNewWorkspace?: (repoId: string) => void
  /** Canvas zoom and the frame's size, which set the picker's scale. */
  zoom: number
  frameWidth: number
  frameHeight: number
}

/** Room the picker keeps from the frame's edges, in frame pixels. */
const FRAME_INSET = 24

/**
 * What an unassigned frame shows in its body (#798): the Workspaces it could
 * preview, each as the sidebar shows it (status icon and pill), and New
 * workspace. Picking one assigns it to the frame.
 *
 * It sits where the frame's status screen would, on the same surface. The root
 * stays pointer-transparent so the frame still drags and selects through the
 * empty space; only the list takes the pointer.
 *
 * Like the frame's title, it keeps one screen size at any zoom, so a large
 * frame zoomed out still has a readable picker; it only shrinks further when
 * the frame itself is too small on screen to hold it.
 */
export function UnassignedFramePicker({
  branches,
  repos,
  statusContext,
  onAssign,
  onNewWorkspace,
  zoom,
  frameWidth,
  frameHeight,
}: UnassignedFramePickerProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () =>
      setContentSize({ width: el.offsetWidth, height: el.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const scale = Math.min(
    1 / zoom,
    contentSize.width
      ? (frameWidth - FRAME_INSET * 2) / contentSize.width
      : Infinity,
    contentSize.height
      ? (frameHeight - FRAME_INSET * 2) / contentSize.height
      : Infinity
  )
  const pickable = branches.filter(
    (b) => b.ref && b.status !== "error" && b.status !== "stopped"
  )
  const creatable = onNewWorkspace ? repos : []

  return (
    <Empty
      data-frame-stage="unassigned"
      className="pointer-events-none absolute inset-0 gap-3 rounded-none bg-white dark:bg-zinc-900"
    >
      <div
        ref={contentRef}
        className="flex flex-col items-center gap-3"
        style={{ transform: `scale(${scale})` }}
      >
        <EmptyTitle>Choose a Workspace</EmptyTitle>
        {pickable.length === 0 && creatable.length === 0 ? (
          <EmptyDescription className="text-xs/relaxed">
            Add a project to create one.
          </EmptyDescription>
        ) : (
          <TooltipProvider>
            <Command
              // cmdk always highlights an item, the first one by default. Show
              // it only while the pointer or focus is in the list, so no
              // Workspace reads as the frame's current one.
              className="pointer-events-auto size-auto w-64 border shadow-xs not-focus-within:not-hover:**:data-selected:bg-transparent!"
              // Keep the press on the list: the canvas would otherwise read it as
              // a select or the start of a drag on the frame underneath.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {/* Only the Workspaces scroll, so New workspace stays in view. */}
              <CommandList className="max-h-none overflow-visible">
                {pickable.length > 0 && (
                  <CommandGroup className="no-scrollbar max-h-44 overflow-y-auto">
                    {pickable.map((b) => (
                      <CommandItem
                        key={b.id}
                        value={b.id}
                        onSelect={() => onAssign(b.id)}
                      >
                        {/* The status glyphs differ in width (a 14px spinner, a
                        16px branch), so a fixed slot keeps the pills lined up. */}
                        <span className="flex size-4 shrink-0 items-center justify-center">
                          <WorkspaceStatusIcon
                            branch={b}
                            context={statusContext(b.id)}
                            onRetry={noop}
                            onRecreate={noop}
                          />
                        </span>
                        <BranchBadge
                          branch={b.ref}
                          colorKey={b.id}
                          colorIndex={b.colorIndex}
                          className="min-w-0 px-1.5 py-0 text-[11px]"
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {pickable.length > 0 && creatable.length > 0 && (
                  <CommandSeparator />
                )}
                {creatable.length > 0 && (
                  <CommandGroup>
                    {creatable.map((repo) => (
                      <CommandItem
                        key={repo.id}
                        value={`__new__ ${repo.id}`}
                        onSelect={() => onNewWorkspace?.(repo.id)}
                      >
                        <Plus />
                        <span className="truncate">
                          New workspace
                          {creatable.length > 1 && (
                            <span className="text-muted-foreground">
                              {" "}
                              in {repo.name?.trim() || repo.repoFullName}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </TooltipProvider>
        )}
      </div>
    </Empty>
  )
}
