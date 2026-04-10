"use client"

import { ReactNode } from "react"
import { LiveMap, LiveObject } from "@liveblocks/client"
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react/suspense"
import "@/lib/liveblocks.types"

const CURSOR_COLORS = [
  "#E57373",
  "#64B5F6",
  "#81C784",
  "#FFB74D",
  "#BA68C8",
  "#4DD0E1",
  "#FF8A65",
  "#A1887F",
]

function getRandomColor() {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]
}

export function RoomProviderWrapper({
  roomId,
  children,
}: {
  roomId: string
  children: ReactNode
}) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={roomId}
        initialPresence={{
          cursor: null,
          viewport: { x: 0, y: 0, zoom: 1 },
          name: "",
          color: getRandomColor(),
        }}
        initialStorage={{
          sandboxes: new LiveMap(),
          artboards: new LiveMap(),
        }}
      >
        <ClientSideSuspense
          fallback={
            <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          }
        >
          {children}
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  )
}
