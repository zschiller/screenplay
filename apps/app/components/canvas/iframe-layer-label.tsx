"use client"

import { useMemo, useState } from "react"
import { Braces, Check, ChevronsUpDown } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { BranchBadge } from "@/components/branch-badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
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
import type { BranchData } from "@/lib/types"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { normalizeRoute } from "@/lib/route-utils"
import { LayerTitleText } from "./layer-title-bar"

interface IframeLayerLabelProps {
  label: string
  branch?: string
  branchId?: string
  route?: string
  /** Bidirectional shared state from `@screenplay.space/state`. When present
   *  with non-empty keys, a tiny indicator renders inside the route pill. */
  sharedState?: JsonObject
  /** Agents the user can pick from (typically all running agents in the room). */
  assignableBranches?: BranchData[]
  onAssignBranch?: (branchId: string) => void
  /** Routes known for the agent backing this iframeLayer. Drives the route picker. */
  discoveredRoutes?: { route: string; label: string }[]
  onSelectRoute?: (route: string) => void
  /** True when this frame is selected (directly or because its group is). */
  selected?: boolean
  /** Remote selector's color for the name. Ignored while locally selected. */
  remoteSelectedColor?: string
  /** Pointer-down select for the frame name — mirrors the frame body's instant-select behavior. */
  onSelectFrame?: (shiftKey: boolean) => void
  /** Inline rename for the frame name. When provided, double-clicking the
   *  name swaps it into a contenteditable. */
  onRename?: (next: string) => void
}

/**
 * The Iframe Layer's title row — the branch picker/badge, the frame name, and
 * the route picker/badge. Rendered inside the shared `LayerTitleBar` (owned by
 * the Layer Shell), which supplies the drag-handle routing and group label;
 * this component is purely the content-specific row.
 */
export function IframeLayerLabel({
  label,
  branch,
  branchId,
  route,
  sharedState,
  assignableBranches,
  onAssignBranch,
  discoveredRoutes,
  onSelectRoute,
  selected,
  remoteSelectedColor,
  onSelectFrame,
  onRename,
}: IframeLayerLabelProps) {
  return (
    <div className="flex min-h-[18px] max-w-full items-center gap-2 overflow-hidden has-[[data-editable-text=editing]]:overflow-visible">
      {onAssignBranch ? (
        <BranchPicker
          branch={branch}
          currentBranchId={branchId}
          colorKey={branchId}
          colorIndex={
            assignableBranches?.find((a) => a.id === branchId)?.colorIndex
          }
          assignableBranches={assignableBranches ?? []}
          onAssignBranch={onAssignBranch}
        />
      ) : branch ? (
        <BranchBadge
          branch={branch}
          colorKey={branchId}
          colorIndex={
            assignableBranches?.find((a) => a.id === branchId)?.colorIndex
          }
          className="max-w-[1.25rem] shrink-0 px-1 py-0 text-[10px] transition-[max-width] duration-200 hover:max-w-[30rem] hover:delay-500"
        />
      ) : null}
      <LayerTitleText
        title={label}
        selected={selected}
        color={remoteSelectedColor}
        onSelectLayer={(shiftKey) => onSelectFrame?.(shiftKey)}
        onRename={onRename}
        placeholder="Untitled"
      />
      {branch &&
        (onSelectRoute ? (
          <RoutePicker
            route={route}
            discoveredRoutes={discoveredRoutes ?? []}
            onSelectRoute={onSelectRoute}
            sharedState={sharedState}
          />
        ) : (
          <Badge
            variant="outline"
            className="max-w-[9rem] min-w-[20px] shrink-0 border-transparent bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground/50 transition-[max-width] delay-300 duration-200 hover:max-w-full hover:delay-500"
          >
            <span className="truncate">{route || "/"}</span>
            <SharedStateIndicator sharedState={sharedState} />
          </Badge>
        ))}
    </div>
  )
}

interface RoutePickerProps {
  route?: string
  discoveredRoutes: { route: string; label: string }[]
  onSelectRoute: (route: string) => void
  sharedState?: JsonObject
}

function RoutePicker({
  route,
  discoveredRoutes,
  onSelectRoute,
  sharedState,
}: RoutePickerProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")

  const currentRoute = route || "/"
  const trimmed = input.trim()
  const typedRoute = trimmed ? normalizeRoute(trimmed) : ""
  const hasExactMatch = typedRoute
    ? discoveredRoutes.some((r) => r.route === typedRoute)
    : true
  const filteredRoutes = (
    trimmed
      ? discoveredRoutes.filter((r) =>
          r.route.toLowerCase().includes(trimmed.toLowerCase())
        )
      : discoveredRoutes
  )
    .slice()
    .sort((a, b) => a.route.localeCompare(b.route))

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
          <Badge
            variant="outline"
            // `delay-300` on the collapse keeps the pill from visibly
            // shrinking when the cursor crosses onto the trailing `{}`
            // indicator and momentarily drops `group-hover` before the
            // tooltip's delayed-open re-grants it. Expansion waits `delay-500`
            // to match the branch pill.
            className="max-w-[9rem] min-w-[20px] border-transparent bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground/50 transition-[max-width] delay-300 duration-200 group-hover:max-w-full group-hover:delay-500 group-data-[state=open]:max-w-full group-data-[state=open]:delay-0"
          >
            <span className="truncate">{currentRoute}</span>
            <SharedStateIndicator sharedState={sharedState} />
          </Badge>
          <ChevronsUpDown
            aria-hidden
            // Mirror the route badge's `delay-300` collapse / `delay-500`
            // expand so a one-frame `group-hover` drop — which happens as the
            // cursor crosses onto the trailing `{}` indicator — doesn't snap
            // the chevron closed and flicker it.
            className="ml-0 h-3 w-0 shrink-0 text-muted-foreground opacity-0 transition-all delay-300 duration-200 group-hover:ml-1 group-hover:w-3 group-hover:opacity-100 group-hover:delay-500 group-data-[state=open]:ml-1 group-data-[state=open]:w-3 group-data-[state=open]:opacity-100 group-data-[state=open]:delay-0"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
      >
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
                    <Check
                      className={`shrink-0 ${r.route === currentRoute ? "" : "opacity-0"}`}
                    />
                    <Badge
                      variant="outline"
                      className="border-transparent bg-muted px-1.5 py-0 font-mono text-[11px] text-foreground/50 transition-none [[data-selected=true]_&]:mix-blend-multiply dark:[[data-selected=true]_&]:mix-blend-screen"
                    >
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
                      <Badge
                        variant="outline"
                        className="border-transparent bg-muted px-1.5 py-0 font-mono text-[11px] text-foreground/50 transition-none [[data-selected=true]_&]:mix-blend-multiply dark:[[data-selected=true]_&]:mix-blend-screen"
                      >
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
  currentBranchId?: string
  colorKey?: string
  colorIndex?: number
  assignableBranches: BranchData[]
  onAssignBranch: (branchId: string) => void
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
          <pre className="max-h-[300px] overflow-auto p-2 font-mono text-[10px] leading-snug break-words whitespace-pre-wrap">
            {json}
          </pre>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function BranchPicker({
  branch,
  currentBranchId,
  colorKey,
  colorIndex,
  assignableBranches,
  onAssignBranch,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false)
  const pickableBranches = assignableBranches.filter(
    (a) => a.ref && a.status !== "error" && a.status !== "stopped"
  )

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
              className="max-w-[1.25rem] shrink-0 px-1 py-0 text-[10px] transition-[max-width] duration-200 group-hover:max-w-[30rem] group-hover:delay-500 group-data-[state=open]:max-w-[30rem]"
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
                ? "ml-0 h-3 w-0 shrink-0 text-muted-foreground opacity-0 transition-all duration-150 group-hover:ml-1 group-hover:w-3 group-hover:opacity-100 group-hover:delay-500 group-data-[state=open]:ml-1 group-data-[state=open]:w-3 group-data-[state=open]:opacity-100"
                : "ml-1 h-3 w-3 shrink-0 text-muted-foreground"
            }
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Search branches..." />
          <CommandList>
            <CommandEmpty>No branches found.</CommandEmpty>
            <CommandGroup>
              {pickableBranches.map((a) => {
                const isBusy =
                  a.status === "creating" || a.status === "starting"
                return (
                  <CommandItem
                    key={a.id}
                    value={a.ref}
                    onSelect={() => {
                      onAssignBranch(a.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={`shrink-0 ${a.id === currentBranchId ? "" : "opacity-0"}`}
                    />
                    <BranchBadge
                      branch={a.ref}
                      colorKey={a.id}
                      colorIndex={a.colorIndex}
                      className="px-1.5 py-0 text-[11px]"
                    />
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
