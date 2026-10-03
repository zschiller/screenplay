"use client"

import { useEffect, useRef, type RefObject } from "react"

import type { ScreenplayDom } from "@/hooks/use-screenplay-dom"
import {
  AGENT_PARTY,
  frameControlKey,
  type FrameControlRecord,
} from "@/lib/canvas/frame-control"
import { driveFrames, runFrameDriveRelay } from "@/lib/frame-drive/mac/relay"
import {
  FRAME_DRIVE_PATH,
  FRAME_DRIVE_ROOM_PARAM,
} from "@/lib/frame-drive/mac/protocol"
import { fetchToken, websocketUrl } from "@/lib/yjs-host/y-websocket-client"
import type { YjsCollection } from "@/lib/yjs/schema"

// The query parameter the local servers' gate reads the secret from
// (`LOCAL_WS_TOKEN_PARAM` in the server-only `lib/local-ws-guard.ts`).
const TOKEN_PARAM = "token"
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 10_000

/**
 * The canvas end of the Mac drive channel (#1389), desktop only: while this
 * canvas is open, the agent can drive its frames. Each op is checked against
 * Frame Control here too, so a person who takes a frame stops the agent at
 * once. Renders nothing.
 */
export function FrameDriveRelay({
  roomId,
  viewerId,
  frameControl,
}: {
  roomId: string
  viewerId: string | null
  frameControl: YjsCollection<FrameControlRecord>
}) {
  useEffect(() => {
    if (!viewerId) return
    let stopped = false
    let relay: { close(): void } | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let delay = RECONNECT_MIN_MS

    const connect = (refresh: boolean) => {
      fetchToken({ refresh }).then(
        (token) => {
          if (stopped) return
          const url = new URL(FRAME_DRIVE_PATH, websocketUrl())
          url.searchParams.set(FRAME_DRIVE_ROOM_PARAM, roomId)
          url.searchParams.set(TOKEN_PARAM, token)
          const socket = new WebSocket(url)
          socket.addEventListener("open", () => {
            delay = RECONNECT_MIN_MS
          })
          // A sidecar restart mints a new secret: fetch it again.
          socket.addEventListener("close", () => reconnect(true))
          relay = runFrameDriveRelay(socket, {
            frames: driveFrames,
            agentDrives: (frameId) =>
              frameControl.get(frameControlKey(frameId, viewerId))?.driver ===
              AGENT_PARTY,
            subscribeControl: (listener) => frameControl.observe(listener),
          })
        },
        () => reconnect(true)
      )
    }
    const reconnect = (refresh: boolean) => {
      relay?.close()
      relay = null
      if (stopped || retry) return
      retry = setTimeout(() => {
        retry = null
        connect(refresh)
      }, delay)
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
    }

    connect(false)
    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      relay?.close()
    }
  }, [roomId, viewerId, frameControl])

  return null
}

/** Lets the agent drive this frame through the relay, while it's mounted. */
export function useDriveFrame(
  frameId: string,
  dom: ScreenplayDom,
  iframeRef: RefObject<HTMLIFrameElement | null>,
  zoom: number
) {
  // Read at snapshot time, so zooming doesn't re-register the frame.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  })
  useEffect(
    () =>
      driveFrames.register(frameId, {
        drive: (op) => dom.drive(op),
        stop: () => dom.stopDrive(),
        where: () => {
          const r = iframeRef.current?.getBoundingClientRect()
          return {
            rect: r
              ? { x: r.x, y: r.y, width: r.width, height: r.height }
              : null,
            window: { width: window.innerWidth, height: window.innerHeight },
            zoom: zoomRef.current,
            visibility: document.visibilityState,
          }
        },
      }),
    [frameId, dom, iframeRef]
  )
}
