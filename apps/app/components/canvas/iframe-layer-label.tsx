"use client"

import { useMemo, useState } from "react"
import {
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  RotateCw,
} from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { IconButton } from "@workspace/ui/components/icon-button"
import { cn } from "@workspace/ui/lib/utils"
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

/**
 * The frame header's height in screen px. The header is counter-scaled like
 * every canvas label, so this holds at any zoom; the Selection Overlay and the
 * resize handles use it to wrap header and body as one object.
 */
export const FRAME_HEADER_HEIGHT = 34

/** What the header's status dot says about the preview. */
export type FrameHeaderStatus =
  | "live"
  | "loading"
  | "disconnected"
  | "failed"
  | "stopped"

const STATUS_LABEL: Record<FrameHeaderStatus, string> = {
  live: "Live",
  loading: "Loading",
  disconnected: "Dev server disconnected",
  failed: "Preview failed",
  stopped: "Workspace stopped",
}

const STATUS_DOT: Record<Exclude<FrameHeaderStatus, "loading">, string> = {
  live: "bg-success",
  disconnected: "bg-warning",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
}

interface IframeLayerLabelProps {
  /** The frame's on-screen width in px, which the header spans exactly. */
  width: number
  label: string
  branch?: string
  branchId?: string
  route?: string
  /** Bidirectional shared state from `@screenplay.space/state`. When present
   *  with non-empty keys, a tiny indicator renders inside the route field. */
  sharedState?: JsonObject
  /** Agents the user can pick from (typically all running agents in the room). */
  assignableBranches?: BranchData[]
  onAssignBranch?: (branchId: string) => void
  /** Routes known for the agent backing this iframeLayer. Drives the route picker. */
  discoveredRoutes?: { route: string; label: string }[]
  onSelectRoute?: (route: string) => void
  /** The device the frame's size matches (a preset's category), or its size. */
  device?: string
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
  onReload?: () => void
  /** The preview's state, or unset while the frame has no Workspace. */
  status?: FrameHeaderStatus
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

/** Keep a press on a header control from starting a frame drag. */
const stopPointer = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
}

/**
 * The Iframe Layer's header bar (issue #795), attached to the frame's top
 * edge: the Workspace picker, the frame name and device, back and forward, the
 * route field, reload, and a status dot. Rendered inside the shared
 * `LayerTitleBar` (owned by the Layer Shell), which supplies the drag-handle
 * routing and the group caption above it; pressing the bar's empty space drags
 * the frame like its body does.
 *
 * The bar is a size container, so on a narrow frame the device goes first,
 * then the navigation buttons, and the name and route field truncate.
 */
export function IframeLayerLabel({
  width,
  label,
  branch,
  branchId,
  route,
  sharedState,
  assignableBranches,
  onAssignBranch,
  discoveredRoutes,
  onSelectRoute,
  device,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  status,
  selected,
  remoteSelectedColor,
  onSelectFrame,
  onRename,
}: IframeLayerLabelProps) {
  const colorIndex = assignableBranches?.find(
    (a) => a.id === branchId
  )?.colorIndex
  return (
    <div
      data-frame-header=""
      className="@container flex items-center gap-2 rounded-t-md bg-background pr-1.5 pl-2 ring-1 ring-foreground/10 has-[[data-editable-text=editing]]:overflow-visible"
      style={{ width, height: FRAME_HEADER_HEIGHT }}
    >
      {onAssignBranch ? (
        <BranchPicker
          branch={branch}
          currentBranchId={branchId}
          colorKey={branchId}
          colorIndex={colorIndex}
          assignableBranches={assignableBranches ?? []}
          onAssignBranch={onAssignBranch}
        />
      ) : branch ? (
        <BranchBadge
          branch={branch}
          colorKey={branchId}
          colorIndex={colorIndex}
          className="max-w-[1.25rem] shrink-0 px-1 py-0 text-[10px] transition-[max-width] duration-200 hover:max-w-[30rem] hover:delay-500"
        />
      ) : null}
      <div className="flex min-w-0 shrink items-baseline gap-1.5">
        <LayerTitleText
          title={label}
          selected={selected}
          color={remoteSelectedColor}
          onSelectLayer={(shiftKey) => onSelectFrame?.(shiftKey)}
          onRename={onRename}
          placeholder="Untitled"
        />
        {device && (
          <span className="hidden shrink-0 text-xs text-muted-foreground @[26rem]:inline">
            {device}
          </span>
        )}
      </div>
      {branch && (
        <div className="ml-auto flex min-w-12 flex-1 items-center gap-1 @[26rem]:ml-2">
          <div
            className="hidden shrink-0 items-center @[18rem]:flex"
            {...stopPointer}
          >
            <IconButton
              label="Back"
              tooltipSide="bottom"
              disabled={!canGoBack}
              onClick={onBack}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              label="Forward"
              tooltipSide="bottom"
              disabled={!canGoForward}
              onClick={onForward}
            >
              <ChevronRight />
            </IconButton>
          </div>
          <RouteField
            route={route}
            discoveredRoutes={discoveredRoutes ?? []}
            onSelectRoute={onSelectRoute}
            sharedState={sharedState}
          />
          <div className="hidden shrink-0 @[18rem]:flex" {...stopPointer}>
            <IconButton label="Reload" tooltipSide="bottom" onClick={onReload}>
              <RotateCw />
            </IconButton>
          </div>
        </div>
      )}
      {status && <StatusDot status={status} />}
    </div>
  )
}

function StatusDot({ status }: { status: FrameHeaderStatus }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            aria-label={STATUS_LABEL[status]}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              // Pushed to the far edge when there's no route field to do it.
              "first:ml-auto"
            )}
            {...stopPointer}
          >
            {status === "loading" ? (
              <Spinner className="size-3 text-muted-foreground" />
            ) : (
              <span
                className={cn("size-1.5 rounded-full", STATUS_DOT[status])}
              />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{STATUS_LABEL[status]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface RouteFieldProps {
  route?: string
  discoveredRoutes: { route: string; label: string }[]
  /** Unset while the frame can't navigate (a read-only viewer). */
  onSelectRoute?: (route: string) => void
  sharedState?: JsonObject
}

/**
 * The header's route field: the frame's current route, like a browser's
 * address bar. Pressing it opens a search box where you type any route (Enter
 * goes there) or pick one the Workspace has discovered.
 */
function RouteField({
  route,
  discoveredRoutes,
  onSelectRoute,
  sharedState,
}: RouteFieldProps) {
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

  const field = (
    <span className="flex h-6 min-w-0 flex-1 items-center rounded-md bg-muted px-2 font-mono text-[11px] text-muted-foreground">
      <span className="truncate">{currentRoute}</span>
      <SharedStateIndicator sharedState={sharedState} />
    </span>
  )

  if (!onSelectRoute) {
    return (
      <div className="flex min-w-0 flex-1" {...stopPointer}>
        {field}
      </div>
    )
  }

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
          aria-label={`Route: ${currentRoute}`}
          className="group flex min-w-0 flex-1 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 hover:[&>span]:text-foreground data-[state=open]:[&>span]:text-foreground"
          {...stopPointer}
        >
          {field}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
        // Leave focus on the canvas after picking a route, like the route
        // pill did, instead of ringing the field.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type a route…"
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
              Choose a workspace
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
          <CommandInput placeholder="Search workspaces…" />
          <CommandList>
            <CommandEmpty>No workspaces found.</CommandEmpty>
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
