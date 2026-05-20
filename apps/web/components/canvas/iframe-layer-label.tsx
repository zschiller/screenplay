"use client"

import { useMemo, useState } from "react"
import { Braces, Check, ChevronsUpDown } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { BranchBadge } from "@/components/branch-badge"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Spinner } from "@workspace/ui/components/spinner"
import type { AgentData } from "@/lib/types"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { normalizeRoute } from "@/lib/route-utils"
import { LayerTitleBar, LayerTitleText } from "./layer-title-bar"

interface IframeLayerLabelProps {
  /** Frame id — routed through `LayerTitleBar` to start reorder drags. */
  iframeLayerId: string
  label: string
  branch?: string
  sandboxId?: string
  route?: string
  /** Bidirectional shared state from `@screenplay.space/state`. When present
   *  with non-empty keys, a tiny indicator renders inside the route pill. */
  sharedState?: JsonObject
  zoom: number
  iframeLayerWidth: number
  /** Base move-drag handlers — `LayerTitleBar` composes them with the
   *  reorder-request hook so the bar lifts the frame into a reorder gesture
   *  in multi-member groups and falls back to a group-move drag otherwise. */
  dragHandlers?: {
    onPointerDown: (e: React.PointerEvent) => void
    [key: string]: unknown
  }
  /** Ask the canvas to start a reorder drag from this frame's title bar. */
  onRequestReorderDrag?: (iframeLayerId: string, e: React.PointerEvent) => boolean
  /** Drag handlers attached to the GroupLabel button — separate set so the
   *  group label moves the whole group rather than reordering a single
   *  frame within the group. */
  groupLabelDragHandlers?: Record<string, unknown>
  /** Agents the user can pick from (typically all running agents in the room). */
  assignableAgents?: AgentData[]
  onAssignAgent?: (agentId: string) => void
  /** Routes known for the agent backing this iframeLayer. Drives the route picker. */
  discoveredRoutes?: { route: string; label: string }[]
  onSelectRoute?: (route: string) => void
  /** True when this frame is selected (directly or because its group is). */
  selected?: boolean
  /** Group display name — only passed for the leftmost iframeLayer in a multi-iframeLayer group. */
  groupLabel?: string
  /** True when the parent group is selected — colors the group label. */
  groupSelected?: boolean
  /** Click handler for the group label. When provided, the label is interactive. */
  onSelectGroup?: (shiftKey: boolean) => void
  /** Inline rename for the group label. */
  onRenameGroup?: (next: string) => void
  /**
   * When the frame is being reorder-dragged, these world-space translation
   * values are applied to the outer frame container. The group label sits
   * inside that container, so we apply an inverse translate here to keep it
   * visually anchored to the group's original top-left while the rest of
   * the frame moves with the cursor.
   */
  reorderDragTranslateX?: number
  reorderDragTranslateY?: number
  /** True when the frame is in cmd-pop preview — hide the group label so the
   *  about-to-be-new-group doesn't visually pretend it's still in the source
   *  group. */
  reorderDragPopped?: boolean
  /** Pointer-down select for the frame name — mirrors the frame body's instant-select behavior. */
  onSelectFrame?: (shiftKey: boolean) => void
  /** Inline rename for the frame name. When provided, double-clicking the
   *  name swaps it into a contenteditable. */
  onRename?: (next: string) => void
}

export function IframeLayerLabel({ iframeLayerId, label, branch, sandboxId, route, sharedState, zoom, iframeLayerWidth, dragHandlers, onRequestReorderDrag, groupLabelDragHandlers, assignableAgents, onAssignAgent, discoveredRoutes, onSelectRoute, selected, groupLabel, groupSelected, onSelectGroup, onRenameGroup, onSelectFrame, onRename, reorderDragTranslateX, reorderDragTranslateY, reorderDragPopped }: IframeLayerLabelProps) {
  return (
    <LayerTitleBar
      layerId={iframeLayerId}
      layerWidth={iframeLayerWidth}
      zoom={zoom}
      dragHandlers={dragHandlers}
      onRequestReorderDrag={onRequestReorderDrag}
      groupLabel={groupLabel}
      groupSelected={groupSelected}
      onSelectGroup={onSelectGroup}
      onRenameGroup={onRenameGroup}
      groupLabelDragHandlers={groupLabelDragHandlers}
      reorderDragTranslateX={reorderDragTranslateX}
      reorderDragTranslateY={reorderDragTranslateY}
      reorderDragPopped={reorderDragPopped}
    >
      <div className="flex min-h-[18px] items-center gap-2 max-w-full overflow-hidden has-[[data-editable-text=editing]]:overflow-visible">
        {onAssignAgent ? (
          <BranchPicker
            branch={branch}
            currentAgentId={sandboxId}
            colorKey={sandboxId}
            colorIndex={assignableAgents?.find((a) => a.id === sandboxId)?.colorIndex}
            assignableAgents={assignableAgents ?? []}
            onAssignAgent={onAssignAgent}
          />
        ) : branch ? (
          <BranchBadge
            branch={branch}
            colorKey={sandboxId}
            colorIndex={assignableAgents?.find((a) => a.id === sandboxId)?.colorIndex}
            className="shrink-0 max-w-[1.25rem] hover:max-w-[30rem] transition-[max-width] duration-200 text-[10px] py-0 px-1"
          />
        ) : null}
        <LayerTitleText
          title={label}
          selected={selected}
          onSelectLayer={(shiftKey) => onSelectFrame?.(shiftKey)}
          onRename={onRename}
          placeholder="Untitled"
        />
        {branch && (onSelectRoute ? (
          <RoutePicker
            route={route}
            discoveredRoutes={discoveredRoutes ?? []}
            onSelectRoute={onSelectRoute}
            sharedState={sharedState}
          />
        ) : (
          <Badge variant="outline" className="shrink-0 border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5 min-w-[20px] max-w-[9rem] hover:max-w-full transition-[max-width] duration-200">
            <span className="truncate">{route || "/"}</span>
            <SharedStateIndicator sharedState={sharedState} />
          </Badge>
        ))}
      </div>
    </LayerTitleBar>
  )
}

interface RoutePickerProps {
  route?: string
  discoveredRoutes: { route: string; label: string }[]
  onSelectRoute: (route: string) => void
  sharedState?: JsonObject
}

function RoutePicker({ route, discoveredRoutes, onSelectRoute, sharedState }: RoutePickerProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")

  const currentRoute = route || "/"
  const trimmed = input.trim()
  const typedRoute = trimmed ? normalizeRoute(trimmed) : ""
  const hasExactMatch = typedRoute
    ? discoveredRoutes.some((r) => r.route === typedRoute)
    : true
  const filteredRoutes = (trimmed
    ? discoveredRoutes.filter((r) => r.route.toLowerCase().includes(trimmed.toLowerCase()))
    : discoveredRoutes
  ).slice().sort((a, b) => a.route.localeCompare(b.route))

  const handleSelect = (next: string) => {
    onSelectRoute(next)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setInput("")
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex shrink-0 items-center outline-none focus-visible:outline-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5 min-w-[20px] max-w-[9rem] group-hover:max-w-full group-data-[state=open]:max-w-full transition-[max-width] duration-200">
            <span className="truncate">{currentRoute}</span>
            <SharedStateIndicator sharedState={sharedState} />
          </Badge>
          <ChevronsUpDown
            aria-hidden
            className="h-3 w-0 ml-0 shrink-0 text-muted-foreground opacity-0 group-hover:w-3 group-hover:ml-1 group-hover:opacity-100 group-data-[state=open]:w-3 group-data-[state=open]:ml-1 group-data-[state=open]:opacity-100"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="start" onPointerDown={(e) => e.stopPropagation()}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type a route..."
            value={input}
            onValueChange={setInput}
          />
          <CommandList>
            {filteredRoutes.length === 0 && !typedRoute && (
              <CommandEmpty>No routes yet.</CommandEmpty>
            )}
            {(filteredRoutes.length > 0 || (typedRoute && !hasExactMatch)) && (
              <CommandGroup>
                {filteredRoutes.map((r) => (
                  <CommandItem
                    key={r.route}
                    value={r.route}
                    onSelect={() => handleSelect(r.route)}
                  >
                    <Check className={`shrink-0 ${r.route === currentRoute ? "" : "opacity-0"}`} />
                    <Badge variant="outline" className="border-transparent bg-muted font-mono text-[11px] text-foreground/50 py-0 px-1.5 transition-none [[data-selected=true]_&]:mix-blend-multiply dark:[[data-selected=true]_&]:mix-blend-screen">
                      {r.route}
                    </Badge>
                  </CommandItem>
                ))}
                {typedRoute && !hasExactMatch && (
                  <CommandItem
                    value={`__create__ ${typedRoute}`}
                    onSelect={() => handleSelect(typedRoute)}
                  >
                    <Check className="shrink-0 opacity-0" />
                    <span className="flex items-center gap-1">
                      <span className="text-xs">Go to</span>
                      <Badge variant="outline" className="border-transparent bg-muted font-mono text-[11px] text-foreground/50 py-0 px-1.5 transition-none [[data-selected=true]_&]:mix-blend-multiply dark:[[data-selected=true]_&]:mix-blend-screen">
                        {typedRoute}
                      </Badge>
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface BranchPickerProps {
  branch?: string
  currentAgentId?: string
  colorKey?: string
  colorIndex?: number
  assignableAgents: AgentData[]
  onAssignAgent: (agentId: string) => void
}

interface SharedStateIndicatorProps {
  sharedState?: JsonObject
}

/**
 * Tiny curly-brace glyph rendered inside the route pill when the prototype
 * has published any shared state via `@screenplay.space/state`. Hover to see
 * the full JSON snapshot. Collapses to nothing when the state is empty so
 * unaffected iframeLayers don't grow an extra slot.
 */
function SharedStateIndicator({ sharedState }: SharedStateIndicatorProps) {
  const json = useMemo(() => {
    if (!sharedState) return null
    const keys = Object.keys(sharedState)
    if (keys.length === 0) return null
    try {
      return JSON.stringify(sharedState, null, 2)
    } catch {
      return null
    }
  }, [sharedState])
  if (!json) return null
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="ml-1 inline-flex h-3 w-3 shrink-0 items-center justify-center text-foreground/60"
            // Stop pointer events from bubbling into the route picker so a
            // hover-to-read doesn't accidentally open the route popover.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            aria-label="Synced UI state"
          >
            <Braces className="h-2.5 w-2.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[360px] p-0">
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[10px] leading-snug">
            {json}
          </pre>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function BranchPicker({ branch, currentAgentId, colorKey, colorIndex, assignableAgents, onAssignAgent }: BranchPickerProps) {
  const [open, setOpen] = useState(false)
  const pickableAgents = assignableAgents.filter((a) => a.branch && a.status !== "error" && a.status !== "stopped")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex shrink-0 items-center outline-none focus-visible:outline-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {branch ? (
            <BranchBadge
              branch={branch}
              colorKey={colorKey}
              colorIndex={colorIndex}
              className="shrink-0 max-w-[1.25rem] group-hover:max-w-[30rem] group-data-[state=open]:max-w-[30rem] transition-[max-width] duration-200 text-[10px] py-0 px-1"
            />
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              Choose a branch
            </span>
          )}
          <ChevronsUpDown
            aria-hidden
            className={
              branch
                ? "h-3 w-0 ml-0 shrink-0 text-muted-foreground opacity-0 group-hover:w-3 group-hover:ml-1 group-hover:opacity-100 group-data-[state=open]:w-3 group-data-[state=open]:ml-1 group-data-[state=open]:opacity-100"
                : "h-3 w-3 ml-1 shrink-0 text-muted-foreground"
            }
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="start" onPointerDown={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search branches..." />
          <CommandList>
            <CommandEmpty>No branches found.</CommandEmpty>
            <CommandGroup>
              {pickableAgents.map((a) => {
                const isBusy = a.status === "creating" || a.status === "starting"
                return (
                  <CommandItem
                    key={a.id}
                    value={a.branch}
                    onSelect={() => {
                      onAssignAgent(a.id)
                      setOpen(false)
                    }}
                  >
                    <Check className={`shrink-0 ${a.id === currentAgentId ? "" : "opacity-0"}`} />
                    <BranchBadge branch={a.branch} colorKey={a.id} colorIndex={a.colorIndex} className="text-[11px] py-0 px-1.5" />
                    {isBusy && <Spinner className="ml-auto size-3" />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
