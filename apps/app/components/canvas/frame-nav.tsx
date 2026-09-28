"use client"

import { useState } from "react"
import { Check } from "lucide-react"
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
import { normalizeRoute } from "@/lib/route-utils"
import { SharedStateIndicator } from "./iframe-layer-label"

/**
 * The navigation controls in a selected frame's floating toolbar (issue #795):
 * the route field and the preview's status dot. Back, forward and reload are
 * plain toolbar buttons, so they live with the toolbar itself.
 */

/** What the status dot says about the frame's preview. */
export type FramePreviewStatus =
  | "live"
  | "loading"
  | "disconnected"
  | "failed"
  | "stopped"

const STATUS_LABEL: Record<FramePreviewStatus, string> = {
  live: "Live",
  loading: "Loading",
  disconnected: "Dev server disconnected",
  failed: "Preview failed",
  stopped: "Workspace stopped",
}

const STATUS_DOT: Record<Exclude<FramePreviewStatus, "loading">, string> = {
  live: "bg-success",
  disconnected: "bg-warning",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
}

/** Keep a press on a control from reaching the canvas under the toolbar. */
const stopPointer = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
}

export function FrameStatusDot({ status }: { status: FramePreviewStatus }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            aria-label={STATUS_LABEL[status]}
            className="flex size-6 shrink-0 items-center justify-center"
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
interface FrameRouteFieldProps {
  route?: string
  discoveredRoutes: { route: string; label: string }[]
  /** Unset while the frame can't navigate (a read-only viewer). */
  onSelectRoute?: (route: string) => void
  sharedState?: JsonObject
}

/**
 * The toolbar's route field: the frame's current route, like a browser's
 * address bar. Pressing it opens a search box where you type any route (Enter
 * goes there) or pick one the Workspace has discovered.
 */
export function FrameRouteField({
  route,
  discoveredRoutes,
  onSelectRoute,
  sharedState,
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
    <span className="flex h-6 min-w-0 flex-1 items-center rounded-md bg-muted px-2 font-mono text-[11px] text-muted-foreground">
      <span className="truncate">{currentRoute}</span>
      <SharedStateIndicator sharedState={sharedState} />
    </span>
  )

  if (!onSelectRoute) {
    return (
      <div className="flex w-48 min-w-0" {...stopPointer}>
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
          className="group flex w-48 min-w-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 hover:[&>span]:text-foreground data-[state=open]:[&>span]:text-foreground"
          {...stopPointer}
        >
          {field}
        </button>
      </PopoverTrigger>
      <PopoverContent
        // As wide as the field, like an address bar's suggestions.
        className="w-(--radix-popover-trigger-width) max-w-96 min-w-56 p-0"
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
