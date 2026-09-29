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
            <svg
              width="16"
              height="20"
              viewBox="0 0 16 20"
              fill="none"
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
            >
              <path
                d="M0.928711 0.0737305L15.0713 11.3833L8.20055 11.8235L4.56463 19.0005L0.928711 0.0737305Z"
                fill={presence.color}
              />
            </svg>
            {message !== null ? (
              <div
                className={`mt-1 ml-3 max-w-xs rounded-2xl rounded-tl-none px-2.5 py-1 text-xs shadow-md ${ink}`}
                style={{ backgroundColor: presence.color }}
              >
                <div className="text-xs font-medium opacity-80">{name}</div>
                <div className="leading-snug break-words whitespace-pre-wrap">
                  {message || " "}
                </div>
              </div>
            ) : (
              <span
                className={`mt-1 ml-3 rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${ink}`}
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
