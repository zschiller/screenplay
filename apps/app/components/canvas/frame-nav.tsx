"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import {
  ArrowClockwiseIcon,
  CaretUpDownIcon,
  CheckIcon,
} from "@workspace/ui/components/icons"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  Popover,
  PopoverAnchor,
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
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { workspaceLabel } from "@/lib/workspace-label"
import { workspaceSettingUp } from "@/lib/branch/workspace-state"
import type { BranchData } from "@/lib/types"
import { normalizeRoute } from "@/lib/route-utils"
import { SharedStateIndicator } from "./iframe-layer-label"
import { MaybeWorkspaceHoverCard } from "@/components/workspace-hover-card"
import type { WorkspaceMentionBranch } from "@/components/workspace-mention"
import { CompactWorkspaceMention, WorkspaceCommandList } from "./workspace-list"

/**
 * The address field in a selected frame's floating toolbar (issue #795), like
 * Safari's: the frame's Workspace as the host (press it to switch, #867), the
 * route (edit it in place to go anywhere, #1149), record, and reload. Record
 * runs Create Flow; while it runs the field turns red and counts the screens
 * laid down. A preview that is down shows a dot at the field's start; one
 * loading spins in Reload's place, so the field never shifts.
 */

/** What the preview is doing, as the address field reports it. */
export type FramePreviewStatus =
  "live" | "loading" | "disconnected" | "failed" | "stopped"

const STATUS_LABEL: Record<
  Exclude<FramePreviewStatus, "live" | "loading">,
  string
> = {
  disconnected: "Dev server disconnected",
  failed: "Preview failed",
  stopped: "Workspace stopped",
}

const STATUS_DOT: Record<
  Exclude<FramePreviewStatus, "live" | "loading">,
  string
> = {
  disconnected: "bg-warning-fill",
  failed: "bg-destructive-fill",
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
  status: Exclude<FramePreviewStatus, "live" | "loading">
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
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
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
  // A recording is about its screens; the host comes back when it stops.
  const showHost = !recording && (workspace?.ref || onAssignWorkspace)
  // A Workspace setting up already spins in the host, so Reload keeps its
  // arrow rather than spin a second time.
  const hostSpinning =
    !!showHost && !!workspace && workspaceSettingUp(workspace)
  const loading = status === "loading" && !hostSpinning
  const shownStatus =
    status === "live" || status === "loading" ? undefined : status
  const leading = recording ? (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-current" />
    </span>
  ) : shownStatus ? (
    <StatusIndicator status={shownStatus} />
  ) : null
  const barRef = useRef<HTMLDivElement>(null)
  // The Workspace host takes at most half the bar (#1149). The bar sizes to
  // its content, so it's kept wide enough (up to its cap) for the host's
  // whole mention to fit in its half; only a bar at its cap truncates it.
  const [hostWidth, setHostWidth] = useState<number>()
  // While the route is edited the bar keeps its width, so it doesn't jump.
  const [lockedWidth, setLockedWidth] = useState<number>()
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    let live = true
    void document.fonts?.ready.then(() => live && setFontsReady(true))
    return () => {
      live = false
    }
  }, [])
  useLayoutEffect(() => {
    const host = barRef.current?.querySelector<HTMLElement>(
      "[data-slot=frame-address-host]"
    )
    if (!host) return setHostWidth(undefined)
    const { maxWidth, width } = host.style
    host.style.maxWidth = "none"
    host.style.width = "max-content"
    const natural = host.offsetWidth
    host.style.maxWidth = maxWidth
    host.style.width = width
    setHostWidth(natural)
  }, [showHost, workspace, fontsReady])

  return (
    <div
      ref={barRef}
      style={{
        width: lockedWidth,
        // Half for the host and its 2px margin, plus the bar's 2px padding
        // each side.
        minWidth: hostWidth
          ? `min(28rem, max(14rem, ${hostWidth * 2 + 8}px))`
          : undefined,
      }}
      className={cn(
        "flex h-7 max-w-[28rem] min-w-56 items-center rounded-md bg-muted px-0.5 text-muted-foreground",
        // A recording fills the bar, black on red like every solid fill.
        recording && "bg-destructive-fill text-destructive-foreground"
      )}
      {...stopPointer}
    >
      {leading}
      {showHost && (
        <FrameWorkspaceHost
          workspace={workspace}
          workspaces={workspaces}
          onAssignWorkspace={onAssignWorkspace}
          anchorRef={barRef}
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
        recording={recording}
        anchorRef={barRef}
        onEditingChange={(editing) =>
          setLockedWidth(editing ? barRef.current?.offsetWidth : undefined)
        }
      />
      <IconButton
        label={recording ? "Stop recording" : "Record flow"}
        pressed={recording}
        className={cn(
          // Idle it's a muted dot like Reload's grey; red is for a recording.
          recording
            ? "text-destructive-foreground hover:bg-transparent hover:text-destructive-foreground aria-pressed:bg-transparent dark:hover:bg-transparent"
            : "text-muted-foreground"
        )}
        onClick={onToggleRecording}
      >
        <span
          className={cn(
            "size-2 bg-current",
            recording ? "rounded-[1.5px]" : "rounded-full"
          )}
        />
      </IconButton>
      {!recording && (
        <IconButton
          label="Reload"
          hint={loading ? "Loading" : undefined}
          aria-busy={loading || undefined}
          className="text-muted-foreground"
          onClick={onReload}
        >
          {/* Loading spins in Reload's own place, so nothing shifts. */}
          {loading ? <Spinner aria-hidden /> : <ArrowClockwiseIcon />}
        </IconButton>
      )}
    </div>
  )
}

/** The frame's Workspace, as the address field and the canvas labels name
 *  it: enough of its Branch for the shared mention (#975). */
export type FrameWorkspace = WorkspaceMentionBranch & { branchId: string }

/** A Branch as a {@link FrameWorkspace}, or undefined while it has no ref. */
export function frameWorkspaceOf(
  branch: BranchData | undefined
): FrameWorkspace | undefined {
  return branch?.ref ? { ...branch, branchId: branch.id } : undefined
}

/**
 * The address field's host (issue #867): the frame's Workspace as the shared
 * mention (#975: state icon, plain name, PR badge when there's room), like the
 * site before a browser's path. Pressing it opens the Workspace list; picking
 * one switches only this frame, which keeps its route and state. It takes at
 * most half the bar (#1149) and truncates before the route does; the hover
 * card always has the full name.
 */
function FrameWorkspaceHost({
  workspace,
  workspaces,
  onAssignWorkspace,
  anchorRef,
}: {
  workspace?: FrameWorkspace
  workspaces: BranchData[]
  onAssignWorkspace?: (branchId: string) => void
  /** The address bar, whose left edge the menu drops from. */
  anchorRef: React.RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(false)
  const label = workspace ? workspaceLabel(workspace) : undefined

  const host = workspace ? (
    <CompactWorkspaceMention workspace={workspace} />
  ) : (
    <span className="truncate">Choose a workspace</span>
  )
  // Leading the bar, a 2px margin evens its inset with the 4px above and below.
  const hostClass =
    "flex h-5 max-w-1/2 min-w-8 shrink-[10] items-center gap-1 rounded-sm px-1 text-xs font-medium text-muted-foreground first:ml-0.5"

  if (!onAssignWorkspace) {
    return (
      <MaybeWorkspaceHoverCard branchId={workspace?.branchId} side="bottom">
        <span data-slot="frame-address-host" className={hostClass}>
          {host}
        </span>
      </MaybeWorkspaceHoverCard>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Keyed on open: the trigger anchors itself until Radix sees this
          anchor, and remounting it on open hands the bar back to Popper. */}
      <PopoverAnchor
        key={String(open)}
        virtualRef={anchorRef as React.RefObject<HTMLElement>}
      />
      <MaybeWorkspaceHoverCard
        branchId={workspace?.branchId}
        side="bottom"
        suppressed={open}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-slot="frame-address-host"
            aria-label={label ? `Workspace: ${label}` : "Choose a workspace"}
            className={cn(
              hostClass,
              "pr-1 outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-background"
            )}
          >
            {host}
            <CaretUpDownIcon
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
  /** A recording is black on its red fill, so hover doesn't fill it. */
  recording: boolean
  /** The address bar, whose left edge the suggestions drop from. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Editing began or ended (the bar holds its width meanwhile). */
  onEditingChange?: (editing: boolean) => void
}

/** The "Go to <path>" row's value; a route always starts with "/". */
const GO_TO = "go-to"
/** No row highlighted. cmdk highlights its first row whenever its value is
 *  empty, so "nothing" is a value no row has (with the input in it, so each
 *  keystroke hands cmdk a new value and clears its highlight). */
const NO_ROW = "none"

/**
 * The address field's route, edited in place like Safari's (issue #1149).
 * Hover fills it like the Workspace host and shows the I-beam; pressing it
 * turns the route into an input with all of it selected. Suggestions drop
 * from the bar's left edge at the Workspace menu's width: the discovered
 * routes, filtered once you type, and "Go to <path>" for one not listed.
 * Enter goes, Esc or blur puts the route back.
 */
export function FrameRouteField({
  route,
  discoveredRoutes,
  onSelectRoute,
  sharedState,
  suffix,
  recording,
  anchorRef,
  onEditingChange,
}: FrameRouteFieldProps) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState("")
  // Nothing is highlighted until an arrow key or the pointer picks a row, so
  // Enter goes where you typed.
  const [highlight, setHighlight] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const currentRoute = route || "/"
  // Until you type, the whole list shows under the route you're on.
  const typed = editing && input !== currentRoute
  const trimmed = typed ? input.trim() : ""
  const typedRoute = trimmed ? normalizeRoute(trimmed) : ""
  const showGoTo =
    !!typedRoute && !discoveredRoutes.some((r) => r.route === typedRoute)
  const suggestions = (
    trimmed
      ? discoveredRoutes.filter((r) =>
          r.route.toLowerCase().includes(trimmed.toLowerCase())
        )
      : discoveredRoutes
  )
    .slice()
    .sort((a, b) => a.route.localeCompare(b.route))
  const values = [
    ...suggestions.map((r) => r.route),
    ...(showGoTo ? [GO_TO] : []),
  ]

  useLayoutEffect(() => {
    if (!editing) return
    const field = inputRef.current
    if (!field) return
    field.focus()
    field.select()
    // Show a long route from its start, as it read before the press.
    field.scrollLeft = 0
  }, [editing])

  const text = (
    <>
      <span className="truncate">
        {currentRoute}
        {suffix}
      </span>
      <SharedStateIndicator sharedState={sharedState} />
    </>
  )
  const fieldClass =
    "flex h-5 min-w-0 flex-1 items-center rounded-sm px-1 font-mono text-xs"

  if (!onSelectRoute) {
    return <span className={fieldClass}>{text}</span>
  }

  const stopEditing = () => {
    setEditing(false)
    setHighlight("")
    onEditingChange?.(false)
  }
  const go = (next: string) => {
    stopEditing()
    if (next !== currentRoute) onSelectRoute(next)
  }

  // The row the list shows highlighted. cmdk moves its highlight to the first
  // row on its own when the highlighted row is filtered away, so keys act on
  // what's on screen rather than on `highlight` alone.
  const shownHighlight = () =>
    document
      .getElementById(listId)
      ?.querySelector("[cmdk-item][data-selected=true]")
      ?.getAttribute("data-value") ?? ""

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Typing is the field's: no canvas shortcut, pan or Esc deselect.
    e.stopPropagation()
    if (e.nativeEvent.isComposing) return
    const shown = shownHighlight()
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (values.length === 0) return
      const at = values.indexOf(shown)
      const step = e.key === "ArrowDown" ? 1 : -1
      const next =
        at === -1
          ? step === 1
            ? 0
            : values.length - 1
          : (at + step + values.length) % values.length
      setHighlight(values[next]!)
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (shown === GO_TO) go(typedRoute)
      else if (shown && values.includes(shown)) go(shown)
      else go(typedRoute || currentRoute)
    } else if (e.key === "Escape") {
      e.preventDefault()
      stopEditing()
    }
  }

  return (
    <Popover
      open={editing}
      onOpenChange={(next) => {
        if (!next) stopEditing()
      }}
    >
      <PopoverAnchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />
      {editing ? (
        <span
          className={cn(
            fieldClass,
            "bg-background text-foreground ring-2 ring-ring/50"
          )}
        >
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Route"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="h-full w-0 min-w-0 flex-1 bg-transparent outline-none"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setHighlight("")
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => e.stopPropagation()}
            onBlur={stopEditing}
          />
        </span>
      ) : (
        <button
          type="button"
          aria-label={`Route: ${currentRoute}`}
          className={cn(
            fieldClass,
            "cursor-text text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            // A recording stays black on its fill.
            !recording && "hover:bg-background hover:text-foreground"
          )}
          onClick={() => {
            onEditingChange?.(true)
            setInput(currentRoute)
            setHighlight("")
            setEditing(true)
          }}
        >
          {text}
        </button>
      )}
      <PopoverContent
        // Like an address bar's suggestions: under the bar, from its left
        // edge, at the Workspace menu's width.
        className="w-72 p-0"
        side="bottom"
        sideOffset={8}
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
        // Keep focus (and the caret) in the field while picking a row.
        onMouseDown={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // A press in the field moves its caret; it isn't outside.
          if (inputRef.current?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        <Command
          id={listId}
          shouldFilter={false}
          disablePointerSelection
          value={highlight || `${NO_ROW} ${input}`}
        >
          <CommandList>
            {values.length === 0 ? (
              <CommandEmpty>No routes yet.</CommandEmpty>
            ) : (
              <CommandGroup>
                {suggestions.map((r) => (
                  <CommandItem
                    key={r.route}
                    value={r.route}
                    onPointerMove={() => setHighlight(r.route)}
                    onSelect={() => go(r.route)}
                  >
                    <span className="min-w-0 truncate font-mono text-xs">
                      {r.route}
                    </span>
                    <CheckIcon
                      className={cn(
                        "ml-auto size-3.5 shrink-0",
                        r.route !== currentRoute && "invisible"
                      )}
                    />
                  </CommandItem>
                ))}
                {showGoTo && (
                  <CommandItem
                    value={GO_TO}
                    onPointerMove={() => setHighlight(GO_TO)}
                    onSelect={() => go(typedRoute)}
                  >
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Go to
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs">
                      {typedRoute}
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
