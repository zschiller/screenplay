"use client"

import { createContext, useContext } from "react"
import { ChevronDown } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import type { OffRouteGroup } from "@/lib/comment-anchor"

/**
 * Each frame's comments on routes other than the one it's showing, by frame
 * id (#785). Provided by the canvas from `useCommentPlacements`; read by each
 * frame's header.
 */
export const OffRouteCommentsContext = createContext<
  ReadonlyMap<string, OffRouteGroup[]>
>(new Map())

export function useOffRouteComments(frameId: string): OffRouteGroup[] {
  return useContext(OffRouteCommentsContext).get(frameId) ?? EMPTY
}

const EMPTY: OffRouteGroup[] = []

const CHIP =
  "flex h-4 shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 text-[10px] font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground"

/**
 * The frame header's chip for comments on other routes: "2 more on /cart",
 * which navigates the frame there. With several routes it reads "5 more on 3
 * routes" and opens a list of them.
 */
export function OffRouteCommentsChip({
  groups,
  onNavigate,
}: {
  groups: OffRouteGroup[]
  onNavigate: (route: string) => void
}) {
  if (groups.length === 0) return null
  const total = groups.reduce((n, g) => n + g.count, 0)
  // Keep a click on the chip from selecting or dragging the frame.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  if (groups.length === 1) {
    const [only] = groups as [OffRouteGroup]
    return (
      <button
        type="button"
        className={CHIP}
        onPointerDown={stop}
        onClick={(e) => {
          stop(e)
          onNavigate(only.route)
        }}
        aria-label={`${total} ${total === 1 ? "comment" : "comments"} on ${only.route}. Go there`}
      >
        {total} more on <span className="font-mono">{only.route}</span>
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={CHIP}
          onPointerDown={stop}
          onClick={stop}
        >
          {total} more on {groups.length} routes
          <ChevronDown aria-hidden className="size-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onPointerDown={stop} onClick={stop}>
        {groups.map((g) => (
          <DropdownMenuItem key={g.route} onSelect={() => onNavigate(g.route)}>
            <span className="font-mono">{g.route}</span>
            <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">
              {g.count}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
