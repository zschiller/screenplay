"use client"

import { useOthers } from "@liveblocks/react/suspense"

interface CursorsProps {
  viewport: { x: number; y: number; zoom: number }
}

export function Cursors({ viewport }: CursorsProps) {
  const others = useOthers()

  return (
    <>
      {others.map(({ connectionId, presence, info }) => {
        if (!presence.cursor) return null

        // Transform other user's canvas-space cursor to our screen-space
        const screenX =
          presence.cursor.x * viewport.zoom + viewport.x
        const screenY =
          presence.cursor.y * viewport.zoom + viewport.y

        return (
          <div
            key={connectionId}
            className="pointer-events-none fixed z-[9999]"
            style={{
              left: screenX,
              top: screenY,
            }}
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
              {info?.name || presence.name || "Anonymous"}
            </span>
          </div>
        )
      })}
    </>
  )
}
