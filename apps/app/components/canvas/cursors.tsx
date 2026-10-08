"use client"

import { resolvePageId } from "@/lib/canvas/pages"
import { presenceInkClass } from "@/lib/canvas/presence-ink"
import type { PageData } from "@/lib/types"
import { useViewing } from "@/lib/viewer/context"
import { useOtherPresences } from "@/lib/yjs/react"

interface CursorsProps {
  viewport: { x: number; y: number; zoom: number }
  pages: PageData[]
  /** The page on screen: only the people on it draw a cursor (#1840). */
  pageId: string
}

export function Cursors({ viewport, pages, pageId }: CursorsProps) {
  const others = useOtherPresences()
  // On a canvas link the server stamps every viewer's presence, so the one
  // without the stamp is the Host's (#1932).
  const viewing = !!useViewing()

  return (
    <>
      {others.map(({ clientId, presence }) => {
        if (!presence.pointer) return null
        if (resolvePageId(pages, presence.pageId) !== pageId) return null

        const screenX = presence.pointer.x * viewport.zoom + viewport.x
        const screenY = presence.pointer.y * viewport.zoom + viewport.y
        const message = presence.message ?? null
        const name = presence.identity.name || "Anonymous"
        const ink = presenceInkClass(presence.color)
        const label =
          viewing && presence.viewer !== true ? `${name} (Host)` : name

        return (
          <div
            key={clientId}
            className="pointer-events-none absolute z-(--z-canvas-presence)"
            style={{ left: screenX, top: screenY }}
          >
            {/* An outline in the page colour, rather than a shadow, keeps
                the pointer readable over any frame. */}
            <svg
              width="16"
              height="20"
              viewBox="0 0 16 20"
              fill="none"
              className="overflow-visible"
            >
              <path
                d="M0.928711 0.0737305L15.0713 11.3833L8.20055 11.8235L4.56463 19.0005L0.928711 0.0737305Z"
                fill={presence.color}
                stroke="var(--background)"
                strokeWidth={1.5}
                strokeLinejoin="round"
                paintOrder="stroke"
              />
            </svg>
            {message !== null ? (
              // The name tag grows into the message: the name stays a 12px
              // label, the message is a sentence at 13px.
              <div
                className={`mt-1 ml-3 w-max max-w-60 rounded px-2 py-1 ${ink}`}
                style={{ backgroundColor: presence.color }}
              >
                <div className="text-xs font-medium">{label}</div>
                <div className="text-sm leading-snug break-words whitespace-pre-wrap">
                  {message || " "}
                </div>
              </div>
            ) : (
              <span
                className={`mt-1 ml-3 block w-max rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${ink}`}
                style={{ backgroundColor: presence.color }}
              >
                {label}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
