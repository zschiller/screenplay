"use client"

import { cn } from "@workspace/ui/lib/utils"

interface GroupLabelProps {
  label: string
  /** True when the parent group is selected — colors the label fuchsia. */
  groupSelected?: boolean
  /** When provided, the label becomes an interactive button. Pointer-down
   *  fires immediately to mirror the frame body's instant-select. */
  onSelectGroup?: (shiftKey: boolean) => void
  /**
   * Group-move drag handlers. Spread onto the button so dragging the group
   * label translates the whole group (same as dragging the frame body).
   * Pointer events on the button stop propagation so the parent frame label
   * — which now runs reorder logic in multi-member groups — doesn't fire.
   */
  dragHandlers?: Record<string, unknown>
}

/**
 * The small "Group N" header that sits above a member when it's the
 * leftmost item in a multi-member group. Shared between `IframeLayer` and
 * `MarkdownLayer` so both kinds of group members render the same label.
 */
export function GroupLabel({ label, groupSelected, onSelectGroup, dragHandlers }: GroupLabelProps) {
  if (onSelectGroup) {
    const dragPointerDown = dragHandlers?.onPointerDown as
      | ((e: React.PointerEvent) => void)
      | undefined
    return (
      <button
        type="button"
        className={cn(
          "mb-0.5 text-xs font-medium truncate min-w-0 cursor-pointer outline-none",
          groupSelected ? "text-fuchsia-500" : "text-muted-foreground",
        )}
        {...dragHandlers}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          // Stop the frame's label drag handlers (which run reorder/select for
          // a single frame) from firing — clicking or dragging the group label
          // should operate on the whole group, not the leftmost frame.
          e.stopPropagation()
          onSelectGroup(e.shiftKey)
          dragPointerDown?.(e)
        }}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {label}
      </button>
    )
  }
  return (
    <div
      className={cn(
        "mb-0.5 text-xs font-medium truncate min-w-0",
        groupSelected ? "text-fuchsia-500" : "text-muted-foreground",
      )}
    >
      {label}
    </div>
  )
}
