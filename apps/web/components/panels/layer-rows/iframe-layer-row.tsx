"use client"

import { MoreHorizontal, Pencil, Route, Trash2 } from "lucide-react"
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
  }: LayerRowProps<IframeLayerData>) {
    const agent = item.sandboxId ? extras.agentsById.get(item.sandboxId) : undefined
    const Icon = iframeLayerKind.Icon

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
          {agent?.branch && (
            <BranchBadge
              branch={agent.branch}
              colorKey={agent.id}
              className="shrink-0 max-w-[1.25rem] hover:max-w-[30rem] transition-[max-width] duration-200 text-[10px] py-0 px-1"
            />
          )}
          <span className="truncate">{iframeLayerKind.getLabel(item)}</span>
          {iframeLayerKind.renderRowAccessory?.(item)}
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
          {agent?.branch && (
            <BranchBadge
              branch={agent.branch}
              colorKey={agent.id}
              className="shrink-0 max-w-[1.25rem] hover:max-w-[30rem] transition-[max-width] duration-200 text-[10px] py-0 px-1"
            />
          )}
          <span className="truncate">{iframeLayerKind.getLabel(item)}</span>
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
  onRename,
  onChangeRoute,
  onRemove,
}: LayerRowMenuProps<IframeLayerData>) {
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
            const newLabel = prompt("Rename frame", item.label)
            if (newLabel?.trim()) onRename(item.id, newLabel.trim())
          }}
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        {onChangeRoute && (
          <DropdownMenuItem
            onClick={() => {
              const newRoute = prompt("Route path", item.route || "/")
              if (newRoute != null) {
                let value = newRoute.trim() || "/"
                if (!value.startsWith("/")) value = "/" + value
                onChangeRoute(item.id, value)
              }
            }}
          >
            <Route />
            Change route
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRemove(item.id)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
