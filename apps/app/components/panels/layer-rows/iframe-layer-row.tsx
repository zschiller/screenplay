"use client"

import { useCallback, useRef } from "react"
import {
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
} from "@workspace/ui/components/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  EditableText,
  editableTextFieldClass,
} from "@workspace/ui/components/editable-text"
import { IconButton } from "@workspace/ui/components/icon-button"
import { cn } from "@workspace/ui/lib/utils"
import { frameWorkspaceOf } from "@/components/canvas/frame-nav"
import { CompactWorkspaceMention } from "@/components/canvas/workspace-list"
import { iframeLayerKind } from "@/lib/layer-kinds/iframe-layer"
import type { BranchData, IframeLayerData } from "@/lib/types"
import {
  useIsFrameHighlighted,
  useWorkspaceHoverProps,
} from "@/lib/workspace-hover-store"
import { renameOnF2 } from "./rename-key"
import { frameRowActionClass, frameRowButtonClass } from "./row-action"
import type { LayerRowMenuProps, LayerRowProps } from "./types"

/** Per-row props the iframeLayer renderer needs that the generic
 *  contract doesn't carry — used to look up the Branch for the branch
 *  badge. The sidebar passes them in through a closure. */
export interface IframeLayerRowExtraProps {
  /** Branches indexed by id, for fast branch-badge lookup. */
  branchesById: ReadonlyMap<string, BranchData>
  /** Frames whose Group's row names the Workspace they all show (#1276).
   *  Every other row inside a Group names its own. */
  framesNamedByGroup: ReadonlySet<string>
}

export function makeIframeLayerRow(extras: IframeLayerRowExtraProps) {
  function IframeLayerRow({
    item,
    variant,
    selected,
    onSelect,
    onActivate,
    onRename,
    editableRef,
  }: LayerRowProps<IframeLayerData>) {
    const branch = item.branchId
      ? extras.branchesById.get(item.branchId)
      : undefined
    const Icon = iframeLayerKind.Icon
    const label = iframeLayerKind.getLabel(item)
    // A Group of one's row names its Workspace; a row inside a Group names it
    // unless the Group's row names the one all its frames show (#1276).
    const showWorkspace =
      variant === "flat" || !extras.framesNamedByGroup.has(item.id)
    const workspace = showWorkspace ? frameWorkspaceOf(branch) : undefined
    const workspaceMention = workspace ? (
      // Names win: the Workspace takes only the room the name leaves.
      <span className="flex min-w-10 flex-1 basis-0 text-xs text-muted-foreground">
        <CompactWorkspaceMention workspace={workspace} layout="row" />
      </span>
    ) : null

    // Hovering this row lights up its Workspace in the sidebar; hovering the
    // Workspace lights up this row (#793). The highlight is the row's own
    // hover background.
    const branchId = item.branchId ?? undefined
    const isHighlighted = useIsFrameHighlighted(branchId)
    const hoverProps = useWorkspaceHoverProps(branchId, "frame")
    const highlightClass = isHighlighted
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : undefined

    const nameEditable = (
      <EditableText
        ref={editableRef}
        as="span"
        value={label}
        onCommit={(next) => onRename(item.id, next)}
        placeholder="Untitled"
        tabIndex={-1}
        className="min-w-0"
        viewClassName="truncate"
        editClassName={cn(
          editableTextFieldClass,
          "-mx-0.5 -my-0.5 min-w-0 px-0.5 py-0.5"
        )}
      />
    )

    if (variant === "flat") {
      return (
        <SidebarMenuButton
          {...hoverProps}
          className={cn(
            "w-full !transition-[width,height] has-[[data-editable-text=editing]]:overflow-visible",
            frameRowButtonClass,
            highlightClass
          )}
          isActive={selected}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(item.id, e.shiftKey)
          }}
          onKeyDown={(e) => renameOnF2(e, editableRef)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onActivate?.(item.id)
          }}
        >
          <Icon className="shrink-0 text-sidebar-foreground/70" />
          {nameEditable}
          {workspaceMention}
        </SidebarMenuButton>
      )
    }
    return (
      <SidebarMenuSubButton asChild isActive={selected}>
        <button
          type="button"
          {...hoverProps}
          className={cn(
            "w-full cursor-pointer !transition-[width,height] has-[[data-editable-text=editing]]:overflow-visible",
            frameRowButtonClass,
            highlightClass
          )}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(item.id, e.shiftKey)
          }}
          onKeyDown={(e) => renameOnF2(e, editableRef)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onActivate?.(item.id)
          }}
        >
          <Icon className="shrink-0 text-sidebar-foreground/70" />
          {nameEditable}
          {workspaceMention}
        </button>
      </SidebarMenuSubButton>
    )
  }
  IframeLayerRow.displayName = "IframeLayerRow"
  return IframeLayerRow
}

export function IframeLayerRowMenu({
  item,
  isSub,
  onRemove,
  editableRef,
}: LayerRowMenuProps<IframeLayerData>) {
  // Rename → close menu → `onCloseAutoFocus` → preventDefault + start
  // editing. Has to be deferred to `onCloseAutoFocus` because Radix's
  // focus trap is still active while the menu is closing, and calling
  // `focus()` on the inline input mid-close gets hijacked by the trap.
  const pendingEditRef = useRef(false)
  const onCloseAutoFocus = useCallback(
    (e: Event) => {
      if (!pendingEditRef.current) return
      pendingEditRef.current = false
      e.preventDefault()
      editableRef?.current?.startEditing()
    },
    [editableRef]
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Frame options" tooltipSide="right" asChild>
          <SidebarMenuAction
            className={cn(
              frameRowActionClass,
              isSub && "!top-1/2 -translate-y-1/2"
            )}
          >
            <DotsThreeIcon />
          </SidebarMenuAction>
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DropdownMenuItem
          onClick={() => {
            pendingEditRef.current = true
          }}
        >
          <PencilSimpleIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onRemove(item.id)}
        >
          <TrashIcon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
