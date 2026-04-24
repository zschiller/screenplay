"use client"

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

        return (
          <div
            key={clientId}
            className="pointer-events-none absolute z-[9999]"
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
            <span
              className="ml-3 mt-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] text-white"
              style={{ backgroundColor: presence.color }}
            >
              {presence.identity.name || "Anonymous"}
            </span>
          </div>
        )
      })}
    </>
  )
}
