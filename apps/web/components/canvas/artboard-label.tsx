"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown, Database } from "lucide-react"
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
import type { HmrStatus, JsonObject } from "@/lib/postmessage-protocol"
import { normalizeRoute } from "@/lib/route-utils"
import { cn } from "@workspace/ui/lib/utils"

interface ArtboardLabelProps {
  label: string
  branch?: string
  sandboxId?: string
  route?: string
  /** Bidirectional shared state from `@screenplay.space/state`. When present
   *  with non-empty keys, a tiny indicator renders inside the route pill. */
  sharedState?: JsonObject
  zoom: number
  artboardWidth: number
  /** Screen-px width to reserve on the right (e.g. for the action buttons). */
  reservedRightPx?: number
  dragHandlers?: Record<string, unknown>
  hmrStatus?: HmrStatus | null
  /** Agents the user can pick from (typically all running agents in the room). */
  assignableAgents?: AgentData[]
  onAssignAgent?: (agentId: string) => void
  /** Routes known for the agent backing this artboard. Drives the route picker. */
  discoveredRoutes?: { route: string; label: string }[]
  onSelectRoute?: (route: string) => void
  /** True when this frame is selected (directly or because its group is). */
  selected?: boolean
  /** Group display name — only passed for the leftmost artboard in a multi-artboard group. */
  groupLabel?: string
  /** True when the parent group is selected — colors the group label. */
  groupSelected?: boolean
  /** Click handler for the group label. When provided, the label is interactive. */
  onSelectGroup?: (shiftKey: boolean) => void
  /** Pointer-down select for the frame name — mirrors the frame body's instant-select behavior. */
  onSelectFrame?: (shiftKey: boolean) => void
  /**
   * Reports the natural (unconstrained) width of the bottom row in screen px —
   * status dot + name + route badge — so the parent can decide how much room
   * is left for action buttons.
   */
  onContentWidthChange?: (width: number) => void
}

const HMR_DOT_COLOR: Record<HmrStatus, string> = {
  connected: "bg-green-500",
  reconnecting: "bg-yellow-500",
  disconnected: "bg-red-500",
}

const HMR_DOT_TITLE: Record<HmrStatus, string> = {
  connected: "Dev server connected",
  reconnecting: "Reconnecting to dev server…",
  disconnected: "Dev server disconnected",
}

export function ArtboardLabel({ label, branch, sandboxId, route, sharedState, zoom, artboardWidth, reservedRightPx = 0, dragHandlers, hmrStatus, assignableAgents, onAssignAgent, discoveredRoutes, onSelectRoute, selected, groupLabel, groupSelected, onSelectGroup, onSelectFrame, onContentWidthChange }: ArtboardLabelProps) {
  const measureRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!onContentWidthChange) return
    const el = measureRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) onContentWidthChange(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onContentWidthChange])

  return (
    <div
      className="absolute bottom-full left-0 flex flex-col items-start whitespace-nowrap"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: "bottom left",
        maxWidth: artboardWidth * zoom,
        marginBottom: 4 / zoom,
      }}
      {...dragHandlers}
    >
      {groupLabel && (
        onSelectGroup ? (
          // Select on pointer-down to match the frame body's instant-select.
          // We let the event keep bubbling so the parent drag closure still
          // arms — when the pointer-up's no-movement path fires the artboard
          // click, it'll be a no-op because the group is already selected
          // (handleArtboardSelect short-circuits when the group owns it).
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
              // Keep keyboard activation working (Enter/Space on a focused button
              // fires click but not pointerdown).
              e.stopPropagation()
            }}
          >
            {groupLabel}
          </button>
        ) : (
          <div
            className={cn(
              "mb-0.5 text-xs font-medium truncate min-w-0",
              groupSelected ? "text-fuchsia-500" : "text-muted-foreground",
            )}
          >
            {groupLabel}
          </div>
        )
      )}
      {(branch || onAssignAgent) && (
        <div className="mb-0.5 max-w-full min-w-0">
          {onAssignAgent ? (
            <BranchPicker
              branch={branch}
              currentAgentId={sandboxId}
              colorKey={sandboxId}
              assignableAgents={assignableAgents ?? []}
              onAssignAgent={onAssignAgent}
            />
          ) : branch ? (
            <BranchBadge branch={branch} colorKey={sandboxId} className="text-[10px] py-0 px-1.5" />
          ) : null}
        </div>
      )}
      <div
        className="flex items-center gap-1.5 max-w-full"
        style={{ maxWidth: Math.max(0, artboardWidth * zoom - reservedRightPx) }}
      >
        {hmrStatus && (
          <span
            title={HMR_DOT_TITLE[hmrStatus]}
            className={cn(
              "inline-block h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-white",
              HMR_DOT_COLOR[hmrStatus],
            )}
          />
        )}
        <span
          className={cn(
            "text-xs font-medium truncate min-w-[0.75em]",
            selected ? "text-fuchsia-500" : "text-foreground/70",
          )}
          onPointerDown={onSelectFrame ? (e) => {
            if (e.button !== 0) return
            onSelectFrame(e.shiftKey)
          } : undefined}
        >
          {label}
        </span>
        {branch && (onSelectRoute ? (
          <RoutePicker
            route={route}
            discoveredRoutes={discoveredRoutes ?? []}
            onSelectRoute={onSelectRoute}
            sharedState={sharedState}
          />
        ) : (
          <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5 min-w-[20px] max-w-full">
            <span className="truncate">{route || "/"}</span>
            <SharedStateIndicator sharedState={sharedState} />
          </Badge>
        ))}
      </div>
      {/* Hidden duplicate of the bottom row used to measure its natural
          (unconstrained, untruncated) width. Mirrors the visible row's
          `min-w-*` floors AND the RoutePicker's chevron-slot (opacity-0 but
          still occupies layout) so the measurement matches what the live row
          actually renders. Without this, labels would truncate before action
          buttons drop out at the threshold. */}
      <div
        ref={measureRef}
        aria-hidden
        className="invisible pointer-events-none absolute -left-[9999px] top-0 flex items-center gap-1.5 whitespace-nowrap"
      >
        {hmrStatus && (
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-white",
              HMR_DOT_COLOR[hmrStatus],
            )}
          />
        )}
        <span className="text-xs font-medium min-w-[0.75em]">{label}</span>
        {branch && (
          onSelectRoute ? (
            <span className="flex items-center gap-1">
              <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5 min-w-[20px]">
                {route || "/"}
                <SharedStateIndicator sharedState={sharedState} />
              </Badge>
              <span className="h-3 w-3 shrink-0" />
            </span>
          ) : (
            <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5 min-w-[20px]">
              {route || "/"}
              <SharedStateIndicator sharedState={sharedState} />
            </Badge>
          )
        )}
      </div>
    </div>
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
  const filteredRoutes = trimmed
    ? discoveredRoutes.filter((r) => r.route.toLowerCase().includes(trimmed.toLowerCase()))
    : discoveredRoutes

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
          className="group flex items-center gap-1 min-w-0 outline-none focus-visible:outline-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5 min-w-[20px] max-w-full">
            <span className="truncate">{currentRoute}</span>
            <SharedStateIndicator sharedState={sharedState} />
          </Badge>
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[state=open]:opacity-100" />
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
  assignableAgents: AgentData[]
  onAssignAgent: (agentId: string) => void
}

interface SharedStateIndicatorProps {
  sharedState?: JsonObject
}

/**
 * Tiny database glyph rendered inside the route pill when the prototype has
 * published any shared state via `@screenplay.space/state`. Hover to see the
 * full JSON snapshot. Collapses to nothing when the state is empty so
 * unaffected artboards don't grow an extra slot.
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
            <Database className="h-2.5 w-2.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-[360px] p-0">
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[10px] leading-snug">
            {json}
          </pre>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function BranchPicker({ branch, currentAgentId, colorKey, assignableAgents, onAssignAgent }: BranchPickerProps) {
  const [open, setOpen] = useState(false)
  const pickableAgents = assignableAgents.filter((a) => a.branch && a.status !== "error" && a.status !== "stopped")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex items-center gap-1 max-w-full min-w-0 outline-none focus-visible:outline-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {branch ? (
            <BranchBadge branch={branch} colorKey={colorKey} className="min-w-0 text-[10px] py-0 px-1.5" />
          ) : (
            <span className="text-xs text-muted-foreground">
              Choose a branch
            </span>
          )}
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[state=open]:opacity-100" />
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
                    <BranchBadge branch={a.branch} colorKey={a.id} className="text-[11px] py-0 px-1.5" />
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
