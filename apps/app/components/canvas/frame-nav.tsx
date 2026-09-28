"use client"

import { useState } from "react"
import { Check, ChevronsUpDown, RotateCw } from "lucide-react"
import { IconButton } from "@workspace/ui/components/icon-button"
import { Badge } from "@workspace/ui/components/badge"
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
import { cn } from "@workspace/ui/lib/utils"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { branchTextClass, getBranchColor } from "@/lib/branch-colors"
import { hasWorkspaceTitle, workspaceLabel } from "@/lib/workspace-label"
import type { BranchData } from "@/lib/types"
import { normalizeRoute } from "@/lib/route-utils"
import { SharedStateIndicator } from "./iframe-layer-label"
import { MaybeWorkspaceHoverCard } from "@/components/workspace-hover-card"
import { WorkspaceCommandList, type FollowGroup } from "./workspace-list"

/**
 * The address field in a selected frame's floating toolbar (issue #795), like
 * Safari's: the frame's Workspace as the host (press it to switch, #867), the
 * route (press it to go anywhere), reload, and record. Record
 * runs Create Flow; while it runs the field turns red and counts the screens
 * laid down. The preview's status shows at the field's start only when it
 * isn't live, so a healthy frame carries no dot.
 */

/** What the preview is doing, as the address field reports it. */
export type FramePreviewStatus =
  | "live"
  | "loading"
  | "disconnected"
  | "failed"
  | "stopped"

const STATUS_LABEL: Record<Exclude<FramePreviewStatus, "live">, string> = {
  loading: "Loading",
  disconnected: "Dev server disconnected",
  failed: "Preview failed",
  stopped: "Workspace stopped",
}

const STATUS_DOT: Record<
  Exclude<FramePreviewStatus, "live" | "loading">,
  string
> = {
  disconnected: "bg-warning",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
}

/** Keep a press on a control from reaching the canvas under the toolbar. */
const stopPointer = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
}

function StatusIndicator({
  status,
}: {
  status: Exclude<FramePreviewStatus, "live">
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            aria-label={STATUS_LABEL[status]}
            className="flex size-5 shrink-0 items-center justify-center"
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
        <TooltipContent>{STATUS_LABEL[status]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface FrameAddressBarProps {
  /** The frame's Workspace, shown before the route like a browser's host. */
  workspace?: FrameWorkspace
  /** Workspaces the frame can switch to. */
  workspaces: BranchData[]
  /** Set on an exception: the list leads with "Follow <Group>" (#868). */
  followGroup?: FollowGroup
  /** Unset while the frame can't switch (a read-only viewer). */
  onAssignWorkspace?: (branchId: string) => void
  route?: string
  discoveredRoutes: { route: string; label: string }[]
  /** Unset while the frame can't navigate (a read-only viewer). */
  onSelectRoute?: (route: string) => void
  sharedState?: JsonObject
  status?: FramePreviewStatus
  onReload: () => void
  recording: boolean
  /** Screens this recording has laid down, the frame's own included. */
  recordedScreens: number
  onToggleRecording: () => void
}

export function FrameAddressBar({
  workspace,
  workspaces,
  followGroup,
  onAssignWorkspace,
  route,
  discoveredRoutes,
  onSelectRoute,
  sharedState,
  status,
  onReload,
  recording,
  recordedScreens,
  onToggleRecording,
}: FrameAddressBarProps) {
  const leading = recording ? (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
    </span>
  ) : status && status !== "live" ? (
    <StatusIndicator status={status} />
  ) : null
  // A recording is about its screens; the host comes back when it stops.
  const showHost = !recording && (workspace?.ref || onAssignWorkspace)

  return (
    <div
      className={cn(
        "flex h-6 max-w-[28rem] min-w-56 items-center rounded-md bg-muted pr-0.5 text-muted-foreground",
        (leading || showHost) && "pl-0.5",
        recording && "bg-destructive/10 text-destructive"
      )}
      {...stopPointer}
    >
      {leading}
      {showHost && (
        <FrameWorkspaceHost
          workspace={workspace}
          workspaces={workspaces}
          followGroup={followGroup}
          onAssignWorkspace={onAssignWorkspace}
        />
      )}
      <FrameRouteField
        route={route}
        discoveredRoutes={discoveredRoutes}
        onSelectRoute={onSelectRoute}
        sharedState={sharedState}
        suffix={
          recording
            ? ` · ${recordedScreens} ${recordedScreens === 1 ? "screen" : "screens"}`
            : undefined
        }
        inset={!leading && !showHost}
        afterHost={!!showHost}
        recording={recording}
      />
      {!recording && (
        <IconButton
          label="Reload"
          size="icon-xs"
          className="size-5 text-muted-foreground"
          onClick={onReload}
        >
          <RotateCw className="size-3" />
        </IconButton>
      )}
      <IconButton
        label={recording ? "Stop recording" : "Record flow"}
        pressed={recording}
        size="icon-xs"
        className={cn(
          "size-5",
          recording && "hover:bg-destructive/15 aria-pressed:bg-transparent"
        )}
        onClick={onToggleRecording}
      >
        <span
          className={cn(
            "size-2 bg-destructive",
            recording ? "rounded-[1.5px]" : "rounded-full"
          )}
        />
      </IconButton>
    </div>
  )
}

/** The frame's Workspace, as the address field names it. */
export interface FrameWorkspace {
  branchId: string
  ref: string
  /** Shown over `ref` when set (#881); see `workspaceLabel`. */
  title?: string
  colorIndex?: number
}

/**
 * The address field's host (issue #867): the frame's Workspace as a dot and its
 * name in the Workspace's text colour, like the site before a browser's path.
 * Pressing it opens the Workspace list; picking one switches only this frame,
 * which keeps its route and state. A long name truncates before the route does.
 */
function FrameWorkspaceHost({
  workspace,
  workspaces,
  followGroup,
  onAssignWorkspace,
}: {
  workspace?: FrameWorkspace
  workspaces: BranchData[]
  followGroup?: FollowGroup
  onAssignWorkspace?: (branchId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const color = workspace
    ? getBranchColor(workspace.branchId, workspace.colorIndex)
    : undefined
  const label = workspace ? workspaceLabel(workspace) : undefined

  const host = (
    <>
      {color && (
        <span className={cn("size-1.5 shrink-0 rounded-full", color.swatch)} />
      )}
      <span className="truncate">{label ?? "Choose a workspace"}</span>
    </>
  )
  const hostClass = cn(
    "flex h-5 max-w-40 min-w-8 shrink-[10] items-center gap-1 rounded-sm px-1.5 text-2xs font-medium",
    workspace && !hasWorkspaceTitle(workspace) && "font-mono",
    color ? branchTextClass(color) : "text-muted-foreground"
  )

  if (!onAssignWorkspace) {
    return (
      <MaybeWorkspaceHoverCard branchId={workspace?.branchId} side="bottom">
        <span className={hostClass}>{host}</span>
      </MaybeWorkspaceHoverCard>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MaybeWorkspaceHoverCard
        branchId={workspace?.branchId}
        side="bottom"
        suppressed={open}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label ? `Workspace: ${label}` : "Choose a workspace"}
            className={cn(
              hostClass,
              "pr-1 outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-background"
            )}
          >
            {host}
            <ChevronsUpDown
              aria-hidden
              className="size-2.5 shrink-0 opacity-60"
            />
          </button>
        </PopoverTrigger>
      </MaybeWorkspaceHoverCard>
      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        sideOffset={8}
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <WorkspaceCommandList
          branches={workspaces}
          currentBranchId={workspace?.branchId}
          followGroup={followGroup}
          onPick={(id) => {
            if (id !== workspace?.branchId) onAssignWorkspace(id)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

interface FrameRouteFieldProps {
  route?: string
  discoveredRoutes: { route: string; label: string }[]
  /** Unset while the frame can't navigate (a read-only viewer). */
  onSelectRoute?: (route: string) => void
  sharedState?: JsonObject
  /** Text after the route (the recording's screen count). */
  suffix?: string
  /** Pad the route in from the field's edge (no status or record dot before it). */
  inset: boolean
  /** Leave a little room after the Workspace host, whose hover fill ends here. */
  afterHost?: boolean
  /** Keep the recording red instead of brightening on hover. */
  recording: boolean
}

/**
 * The address field's route: the frame's current route, like a browser's
 * address bar. Pressing it opens a search box where you type any route (Enter
 * goes there) or pick one the Workspace has discovered.
 */
export function FrameRouteField({
  route,
  discoveredRoutes,
  onSelectRoute,
  sharedState,
  suffix,
  inset,
  afterHost,
  recording,
}: FrameRouteFieldProps) {
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
    <span
      className={cn(
        "flex h-6 min-w-0 flex-1 items-center pr-1 font-mono text-2xs",
        inset && "pl-2",
        afterHost && "pl-1"
      )}
    >
      <span className="truncate">
        {currentRoute}
        {suffix}
      </span>
      <SharedStateIndicator sharedState={sharedState} />
    </span>
  )

  if (!onSelectRoute) {
    return <div className="flex min-w-0 flex-1">{field}</div>
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
          className={cn(
            "flex min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            // Brighten on hover or open, like the route pill; a recording
            // keeps its red.
            !recording &&
              "hover:text-foreground data-[state=open]:text-foreground"
          )}
        >
          {field}
        </button>
      </PopoverTrigger>
      <PopoverContent
        // Like an address bar's suggestions, under the field.
        className="w-56 p-0"
        side="bottom"
        sideOffset={8}
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
                      className="border-transparent bg-muted px-1.5 py-0 font-mono text-2xs text-foreground/50 transition-none [[data-selected=true]_&]:mix-blend-multiply dark:[[data-selected=true]_&]:mix-blend-screen"
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
                        className="border-transparent bg-muted px-1.5 py-0 font-mono text-2xs text-foreground/50 transition-none [[data-selected=true]_&]:mix-blend-multiply dark:[[data-selected=true]_&]:mix-blend-screen"
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
