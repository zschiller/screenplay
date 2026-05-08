"use client"

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
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
import { documentKind } from "@/lib/layer-kinds/document"
import type { DocumentLayerData } from "@/lib/types"
import type { LayerRowMenuProps, LayerRowProps } from "./types"

export function DocumentRow({
  item,
  variant,
  selected,
  onSelect,
  onActivate,
}: LayerRowProps<DocumentLayerData>) {
  const Icon = documentKind.Icon
  if (variant === "flat") {
    return (
      <SidebarMenuButton
        className="w-full !pr-2 !transition-[width,height] group-hover/frame-row:!pr-7 group-focus-within/frame-row:!pr-7 group-has-data-[state=open]/frame-row:!pr-7"
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
        <span className="truncate">{documentKind.getLabel(item)}</span>
      </SidebarMenuButton>
    )
  }
  return (
    <SidebarMenuSubButton asChild isActive={selected}>
      <button
        type="button"
        className="w-full cursor-pointer pr-7"
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
        <span className="truncate">{documentKind.getLabel(item)}</span>
      </button>
    </SidebarMenuSubButton>
  )
}

export function DocumentRowMenu({
  item,
  isSub,
  onRename,
  onRemove,
}: LayerRowMenuProps<DocumentLayerData>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          className={
            isSub
              ? "!top-1/2 -translate-y-1/2 md:opacity-0 group-hover/frame-row:opacity-100 group-focus-within/frame-row:opacity-100 aria-expanded:opacity-100"
              : "md:opacity-0 group-hover/frame-row:opacity-100 group-focus-within/frame-row:opacity-100 aria-expanded:opacity-100"
          }
        >
          <MoreHorizontal />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-48">
        <DropdownMenuItem
          onClick={() => {
            const newTitle = prompt("Rename document", item.title || "Untitled")
            if (newTitle != null) onRename(item.id, newTitle.trim())
          }}
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRemove(item.id)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
