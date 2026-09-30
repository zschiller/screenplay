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
import { EditableText } from "@workspace/ui/components/editable-text"
import { IconButton } from "@workspace/ui/components/icon-button"
import { cn } from "@workspace/ui/lib/utils"
import { frameWorkspaceOf } from "@/components/canvas/frame-nav"
import { CompactWorkspaceMention } from "@/components/canvas/workspace-list"
import { isWorkspaceException } from "@/lib/canvas/group-workspace"
import { iframeLayerKind } from "@/lib/layer-kinds/iframe-layer"
import type { BranchData, IframeLayerData } from "@/lib/types"
import {
  useIsFrameHighlighted,
  useWorkspaceHoverProps,
} from "@/lib/workspace-hover-store"
import type { LayerRowMenuProps, LayerRowProps } from "./types"

/** Per-row props the iframeLayer renderer needs that the generic
 *  contract doesn't carry — used to look up the Branch for the branch
 *  badge. The sidebar passes them in through a closure. */
export interface IframeLayerRowExtraProps {
  /** Branches indexed by id, for fast branch-badge lookup. */
  branchesById: ReadonlyMap<string, BranchData>
  /** Each frame's Group's Workspace, by frame id (#868). A row inside a Group
   *  names its Workspace only when it differs from this. */
  groupBranchIdByLayerId: ReadonlyMap<string, string | undefined>
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
    // only when it differs from the Group's, whose row names it once (#868).
    const showWorkspace =
      variant === "flat" ||
      isWorkspaceException(item, extras.groupBranchIdByLayerId.get(item.id))
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
        className="min-w-0"
        viewClassName="truncate"
        editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-background text-foreground ring-[0.5px] ring-foreground/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
      />
    )

    if (variant === "flat") {
      return (
        <SidebarMenuButton
          {...hoverProps}
          className={cn(
            "w-full !pr-2 !transition-[width,height] group-focus-within/frame-row:!pr-7 group-hover/frame-row:!pr-7 group-has-data-[state=open]/frame-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible",
            highlightClass
          )}
          isActive={selected}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(item.id, e.shiftKey)
          }}
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
            "w-full cursor-pointer !pr-2 !transition-[width,height] group-focus-within/frame-row:!pr-7 group-hover/frame-row:!pr-7 group-has-data-[state=open]/frame-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible",
            highlightClass
          )}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(item.id, e.shiftKey)
          }}
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
            className={
              isSub
                ? "!top-1/2 -translate-y-1/2 group-focus-within/frame-row:opacity-100 group-hover/frame-row:opacity-100 aria-expanded:opacity-100 md:opacity-0"
                : "group-focus-within/frame-row:opacity-100 group-hover/frame-row:opacity-100 aria-expanded:opacity-100 md:opacity-0"
            }
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
