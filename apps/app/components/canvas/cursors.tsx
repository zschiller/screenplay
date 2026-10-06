"use client"

import { presenceInkClass } from "@/lib/canvas/presence-ink"
import { useOtherPresences } from "@/lib/yjs/react"

interface CursorsProps {
  viewport: { x: number; y: number; zoom: number }
}

export function Cursors({ viewport }: CursorsProps) {
  const others = useOtherPresences()

  return (
    <>
      {others.map(({ clientId, presence }) => {
        if (!presence.pointer) return null

        const screenX = presence.pointer.x * viewport.zoom + viewport.x
        const screenY = presence.pointer.y * viewport.zoom + viewport.y
        const message = presence.message ?? null
        const name = presence.identity.name || "Anonymous"
        const ink = presenceInkClass(presence.color)

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
                <div className="text-xs font-medium">{name}</div>
                <div className="text-sm leading-snug break-words whitespace-pre-wrap">
                  {message || " "}
                </div>
              </div>
            ) : (
              <span
                className={`mt-1 ml-3 block w-max rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${ink}`}
                style={{ backgroundColor: presence.color }}
              >
                {name}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
