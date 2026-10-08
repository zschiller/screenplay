"use client"

import { useMemo } from "react"

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { HouseSimpleIcon } from "@workspace/ui/components/icons"

import { resolvePageId } from "@/lib/canvas/pages"
import { presenceInkClass } from "@/lib/canvas/presence-ink"
import type { PageData } from "@/lib/types"
import { useViewing } from "@/lib/viewer/context"
import { useOtherPeers, type PeerPresence } from "@/lib/yjs/react"

/** Avatars a page row shows before the rest collapse into a count. */
const MAX_AVATARS = 3

/**
 * The other people in the canvas by the page they're on (#1840), keyed by
 * page id. Someone on a page that's gone, or on a client from before pages,
 * is on the first page, as their own screen shows.
 */
export function usePeopleByPage(
  pages: readonly PageData[]
): ReadonlyMap<string, PeerPresence[]> {
  const peers = useOtherPeers()
  return useMemo(() => {
    const byPage = new Map<string, PeerPresence[]>()
    for (const { presence } of peers) {
      const pageId = resolvePageId(pages, presence.pageId)
      byPage.set(pageId, [...(byPage.get(pageId) ?? []), presence])
    }
    return byPage
  }, [peers, pages])
}

/**
 * The avatars of the people on one page, at the end of its row: one initial
 * each in their presence colour, overlapping 4px as the toolbar's stack does.
 * On a canvas link the Host's avatar carries a house badge and goes last, so
 * nothing overlaps the badge (#1932).
 */
export function PagePeople({ people }: { people: readonly PeerPresence[] }) {
  const viewing = !!useViewing()
  if (people.length === 0) return null
  // The server stamps every viewer's presence; the one without is the Host's.
  const isHost = (p: PeerPresence) => viewing && p.viewer !== true
  const host = people.find(isHost)
  const others = people.filter((p) => p !== host)
  const shown = host
    ? [...others.slice(0, MAX_AVATARS - 1), host]
    : people.slice(0, MAX_AVATARS)
  const more = people.length - shown.length
  const names = [
    ...(host ? [`${host.identity.name || "Anonymous"} (host)`] : []),
    ...others.map((p) => p.identity.name || "Anonymous"),
  ]
  return (
    <div
      role="img"
      aria-label={names.join(", ")}
      className="ml-auto flex shrink-0 items-center [&>*:not(:first-child)]:-ml-1"
    >
      {shown.map((person, i) => (
        <Avatar
          key={`${person.identity.id}-${i}`}
          size="sm"
          className="size-5 ring-2 ring-sidebar group-hover/menu-button:ring-sidebar-accent group-data-active/menu-button:ring-sidebar-accent"
        >
          {person.identity.avatar ? (
            <AvatarImage src={person.identity.avatar} alt="" />
          ) : null}
          <AvatarFallback
            style={{ backgroundColor: person.color }}
            className={`text-xs font-medium ${presenceInkClass(person.color)}`}
          >
            {initial(person.identity.name)}
          </AvatarFallback>
          {/* 14px with its glyph, over the stock small badge's bare 8px dot. */}
          {person === host ? (
            <AvatarBadge className="-right-1 -bottom-1 ring-sidebar group-hover/menu-button:ring-sidebar-accent group-data-[size=sm]/avatar:size-3.5 group-data-active/menu-button:ring-sidebar-accent group-data-[size=sm]/avatar:[&>svg]:block group-data-[size=sm]/avatar:[&>svg]:size-2">
              <HouseSimpleIcon weight="bold" />
            </AvatarBadge>
          ) : null}
        </Avatar>
      ))}
      {more > 0 ? (
        <span className="pl-1.5 text-xs text-sidebar-foreground/70 tabular-nums">
          +{more}
        </span>
      ) : null}
    </div>
  )
}

function initial(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase()
}
