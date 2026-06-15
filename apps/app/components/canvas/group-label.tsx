"use client"

import { cn } from "@workspace/ui/lib/utils"
import { EditableText } from "@workspace/ui/components/editable-text"
import type { DragHandlers } from "@/hooks/use-iframe-layer-drag"

interface GroupLabelProps {
  label: string
  /** True when the parent group is selected — colors the label fuchsia. */
  groupSelected?: boolean
  /** Color of a *remote* user's group selection. When set (and not locally
   *  `groupSelected`), the label is tinted to this color to match that user's
   *  selection rect. Local selection (fuchsia) takes precedence. */
  color?: string
  /** When provided, the label becomes an interactive button. Pointer-down
   *  fires immediately to mirror the frame body's instant-select. */
  onSelectGroup?: (shiftKey: boolean) => void
  /**
   * Group-move drag handlers. Spread onto the button so dragging the group
   * label translates the whole group (same as dragging the frame body).
   * Pointer events on the button stop propagation so the parent frame label
   * — which now runs reorder logic in multi-member groups — doesn't fire.
   */
  dragHandlers?: DragHandlers
  /** Optional inline rename. When provided, double-click flips the label
   *  into a contenteditable with the same affordance the frame name uses. */
  onRename?: (next: string) => void
}

/**
 * The small "Group N" header that sits above a member when it's the
 * leftmost item in a multi-member group. Shared between `IframeLayer` and
 * `MarkdownLayer` so both kinds of group members render the same label.
 */
export function GroupLabel({
  label,
  groupSelected,
  color,
  onSelectGroup,
  dragHandlers,
  onRename,
}: GroupLabelProps) {
  // Local selection (fuchsia) wins; a remote selector's color applies only
  // when the group isn't locally selected.
  const remoteColor = !groupSelected && color ? color : undefined
  const colorStyle = remoteColor ? { color: remoteColor } : undefined
  if (onSelectGroup) {
    const dragPointerDown = dragHandlers?.onPointerDown as
      | ((e: React.PointerEvent) => void)
      | undefined
    const handleSelectPointerDown = (e: React.PointerEvent) => {
      if (e.button !== 0) return
      // Stop the frame's label drag handlers (which run reorder/select for
      // a single frame) from firing — clicking or dragging the group label
      // should operate on the whole group, not the leftmost frame.
      e.stopPropagation()
      onSelectGroup(e.shiftKey)
      dragPointerDown?.(e)
    }
    const colorClass = groupSelected
      ? "text-fuchsia-500"
      : remoteColor
        ? undefined
        : "text-muted-foreground"

    if (onRename) {
      // Match the frame-label structure exactly: EditableText as a direct
      // child of a `flex items-center` row. `items-center` masks the vertical
      // shift from `py-0.5 -my-0.5`, and `flex-1` gives the editable a stable
      // slot to scroll inside.
      return (
        <div
          className="mb-0.5 flex max-w-full items-center"
          {...dragHandlers}
          onPointerDown={handleSelectPointerDown}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <EditableText
            as="span"
            value={label}
            onCommit={onRename}
            placeholder="Group"
            style={colorStyle}
            className={cn("min-w-[0.75em] text-xs font-medium", colorClass)}
            viewClassName="truncate cursor-grab active:cursor-grabbing"
            editClassName="relative z-10 flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
          />
        </div>
      )
    }

    return (
      <button
        type="button"
        className={cn(
          "mb-0.5 min-w-0 cursor-grab truncate text-xs font-medium outline-none active:cursor-grabbing",
          colorClass
        )}
        style={colorStyle}
        {...dragHandlers}
        onPointerDown={handleSelectPointerDown}
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
        "mb-0.5 min-w-0 truncate text-xs font-medium",
        groupSelected
          ? "text-fuchsia-500"
          : remoteColor
            ? undefined
            : "text-muted-foreground"
      )}
      style={colorStyle}
    >
      {label}
    </div>
  )
}
