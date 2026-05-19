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
import { EditableText } from "@workspace/ui/components/editable-text"
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
}: LayerRowProps<MarkdownLayerData>) {
  const Icon = markdownLayerKind.Icon
  const label = markdownLayerKind.getLabel(item)

  const nameEditable = (
    <EditableText
      as="span"
      value={label}
      onCommit={(next) => onRename(item.id, next)}
      placeholder="Untitled"
      className="min-w-0"
      viewClassName="truncate"
      editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
    />
  )

  if (variant === "flat") {
    return (
      <SidebarMenuButton
        className="w-full !pr-2 !transition-[width,height] group-hover/frame-row:!pr-7 group-focus-within/frame-row:!pr-7 group-has-data-[state=open]/frame-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible"
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
        className="w-full cursor-pointer pr-7 has-[[data-editable-text=editing]]:overflow-visible"
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
  onRename,
  onRemove,
}: LayerRowMenuProps<MarkdownLayerData>) {
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
