"use client"

import { cn } from "@workspace/ui/lib/utils"

interface GroupLabelProps {
  label: string
  /** True when the parent group is selected — colors the label fuchsia. */
  groupSelected?: boolean
  /** When provided, the label becomes an interactive button. Pointer-down
   *  fires immediately to mirror the frame body's instant-select. */
  onSelectGroup?: (shiftKey: boolean) => void
}

/**
 * The small "Group N" header that sits above a member when it's the
 * leftmost item in a multi-member group. Shared between `Artboard` and
 * `DocumentLayer` so both kinds of group members render the same label.
 */
export function GroupLabel({ label, groupSelected, onSelectGroup }: GroupLabelProps) {
  if (onSelectGroup) {
    return (
      <button
        type="button"
        className={cn(
          "mb-0.5 text-xs font-medium truncate min-w-0 cursor-pointer outline-none",
          groupSelected ? "text-fuchsia-500" : "text-muted-foreground",
        )}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          onSelectGroup(e.shiftKey)
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
