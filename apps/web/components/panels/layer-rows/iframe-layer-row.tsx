"use client"

import { useCallback, useRef } from "react"
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
import { BranchBadge } from "@/components/branch-badge"
import { iframeLayerKind } from "@/lib/layer-kinds/iframe-layer"
import type { AgentData, IframeLayerData } from "@/lib/types"
import type { LayerRowMenuProps, LayerRowProps } from "./types"

/** Per-row props the iframeLayer renderer needs that the generic
 *  contract doesn't carry — used to look up the agent for the branch
 *  badge. The sidebar passes them in through a closure. */
export interface IframeLayerRowExtraProps {
  /** Agents indexed by id, for fast branch-badge lookup. */
  agentsById: ReadonlyMap<string, AgentData>
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
    const agent = item.sandboxId ? extras.agentsById.get(item.sandboxId) : undefined
    const Icon = iframeLayerKind.Icon
    const label = iframeLayerKind.getLabel(item)

    const nameEditable = (
      <EditableText
        ref={editableRef}
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
          {agent?.branch && (
            <BranchBadge
              branch={agent.branch}
              colorKey={agent.id}
              colorIndex={agent.colorIndex}
              className="shrink-0 max-w-[1.25rem] hover:max-w-[30rem] transition-[max-width] duration-200 text-[10px] py-0 px-1"
            />
          )}
          {nameEditable}
          {iframeLayerKind.renderRowAccessory?.(item)}
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
          {agent?.branch && (
            <BranchBadge
              branch={agent.branch}
              colorKey={agent.id}
              colorIndex={agent.colorIndex}
              className="shrink-0 max-w-[1.25rem] hover:max-w-[30rem] transition-[max-width] duration-200 text-[10px] py-0 px-1"
            />
          )}
          {nameEditable}
          {iframeLayerKind.renderRowAccessory?.(item)}
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
  const onCloseAutoFocus = useCallback((e: Event) => {
    if (!pendingEditRef.current) return
    pendingEditRef.current = false
    e.preventDefault()
    editableRef?.current?.startEditing()
  }, [editableRef])
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
      <DropdownMenuContent side="right" align="start" className="w-48" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownMenuItem onClick={() => { pendingEditRef.current = true }}>
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
