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
import { cn } from "@workspace/ui/lib/utils"
import { IconButton } from "@workspace/ui/components/icon-button"
import { markdownLayerKind } from "@/lib/layer-kinds/markdown-layer"
import type { MarkdownLayerData } from "@/lib/types"
import type { LayerRowMenuProps, LayerRowProps } from "./types"

export function DocumentRow({
  item,
  variant,
  selected,
  onSelect,
  onActivate,
  onRename,
  editableRef,
}: LayerRowProps<MarkdownLayerData>) {
  const Icon = markdownLayerKind.Icon
  const label = markdownLayerKind.getLabel(item)

  const nameEditable = (
    <EditableText
      ref={editableRef}
      as="span"
      value={label}
      onCommit={(next) => onRename(item.id, next)}
      placeholder="Untitled"
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
        className="w-full !pr-2 !transition-[width,height] group-focus-within/frame-row:!pr-7 group-hover/frame-row:!pr-7 group-has-data-[state=open]/frame-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible"
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
      </SidebarMenuButton>
    )
  }
  return (
    <SidebarMenuSubButton asChild isActive={selected}>
      <button
        type="button"
        className="w-full cursor-pointer !pr-2 !transition-[width,height] group-focus-within/frame-row:!pr-7 group-hover/frame-row:!pr-7 group-has-data-[state=open]/frame-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible"
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
      </button>
    </SidebarMenuSubButton>
  )
}

export function DocumentRowMenu({
  item,
  isSub,
  onRemove,
  editableRef,
}: LayerRowMenuProps<MarkdownLayerData>) {
  // See IframeLayerRowMenu — start editing from `onCloseAutoFocus` so
  // the menu's focus trap is fully torn down before we focus the inline
  // input, otherwise the trap steals focus back.
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
        <IconButton label="Document options" tooltipSide="right" asChild>
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
