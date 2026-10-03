"use client"

import { useEffect, useRef, type RefObject } from "react"

import type { ScreenplayDom } from "@/hooks/use-screenplay-dom"
import {
  AGENT_PARTY,
  frameControlKey,
  type FrameControlRecord,
} from "@/lib/canvas/frame-control"
import { withBasePath } from "@/lib/base-path"
import { driveFrames, runFrameDriveRelay } from "@/lib/frame-drive/canvas/relay"
import {
  FRAME_DRIVE_PATH,
  FRAME_DRIVE_ROOM_PARAM,
  type PageAsk,
} from "@/lib/frame-drive/canvas/protocol"
import { takeFrameInput } from "@/lib/frame-drive/canvas/take-input"
import {
  docRelaySocket,
  FRAME_DRIVE_ANSWER_PATH,
  type FrameDriveAnswerBody,
  type FrameDriveAsk,
} from "@/lib/frame-drive/view/asks"
import { fetchToken, websocketUrl } from "@/lib/yjs-host/y-websocket-client"
import type { YjsCollection } from "@/lib/yjs/schema"

// The query parameter the local servers' gate reads the secret from
// (`LOCAL_WS_TOKEN_PARAM` in the server-only `lib/local-ws-guard.ts`).
const TOKEN_PARAM = "token"
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 10_000
/** The longest a real-input gesture may hold a frame's input (#1385). */
const TAKEN_INPUT_MAX_MS = 15_000

/**
 * The canvas end of the Mac drive channel (#1389), desktop only: while this
 * canvas is open, the agent can drive its frames and mockups. Each op is checked against
 * Frame Control here too, so a person who takes a frame stops the agent at
 * once. Renders nothing.
 */
export function FrameDriveRelay({
  roomId,
  viewerId,
  frameControl,
  reveal,
}: {
  roomId: string
  viewerId: string | null
  frameControl: YjsCollection<FrameControlRecord>
  /** Bring a frame into this canvas's view, for the agent showing it
   *  (#1390). */
  reveal: (frameId: string) => Promise<boolean>
}) {
  // Read when asked, so a new callback doesn't reconnect the channel.
  const revealRef = useRef(reveal)
  useEffect(() => {
    revealRef.current = reveal
  })
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
            reveal: (frameId) => revealRef.current(frameId),
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

/**
 * The canvas end of the drive channel on hosted (#1391): the agent's asks for
 * this viewer come through the Room's doc, and the answers go to the answer
 * route. Only mockups answer (a hosted frame is one shared browser, #1396),
 * and only in the asker's own canvas. Renders nothing.
 */
export function FrameDriveViewRelay({
  roomId,
  viewerId,
  frameControl,
  asks,
  reveal,
}: {
  roomId: string
  viewerId: string | null
  frameControl: YjsCollection<FrameControlRecord>
  asks: YjsCollection<FrameDriveAsk>
  /** Bring a mockup into this canvas's view, for the agent showing it
   *  (#1390). */
  reveal: (frameId: string) => Promise<boolean>
}) {
  const revealRef = useRef(reveal)
  useEffect(() => {
    revealRef.current = reveal
  })
  useEffect(() => {
    if (!viewerId) return
    const socket = docRelaySocket({
      asks: {
        entries: () => asks.toMap(),
        delete: (id) => asks.delete(id),
        observe: (listener) => asks.observe(listener),
      },
      viewerId,
      post: async (answer) => {
        const body: FrameDriveAnswerBody = { room: roomId, answer }
        await fetch(withBasePath(FRAME_DRIVE_ANSWER_PATH), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      },
    })
    const relay = runFrameDriveRelay(socket, {
      frames: driveFrames,
      agentDrives: (frameId) =>
        frameControl.get(frameControlKey(frameId, viewerId))?.driver ===
        AGENT_PARTY,
      subscribeControl: (listener) => frameControl.observe(listener),
      reveal: (frameId) => revealRef.current(frameId),
    })
    return () => relay.close()
  }, [roomId, viewerId, frameControl, asks])

  return null
}

/**
 * Lets the agent drive this frame or mockup through the relay, while it's
 * mounted. `snapshot` reads the page for a screenshot taken away from the
 * canvas (a hosted mockup).
 */
export function useDriveFrame(
  frameId: string,
  dom: ScreenplayDom,
  iframeRef: RefObject<HTMLIFrameElement | null>,
  zoom: number,
  {
    snapshot = false,
    setTakesPointer,
  }: {
    snapshot?: boolean
    /** Let the frame take the pointer for a gesture the Mac plays with real
     *  input (#1385), as Interact does. */
    setTakesPointer?: (on: boolean) => void
  } = {}
) {
  // Read at snapshot time, so zooming doesn't re-register the frame.
  const zoomRef = useRef(zoom)
  const setTakesPointerRef = useRef(setTakesPointer)
  useEffect(() => {
    zoomRef.current = zoom
    setTakesPointerRef.current = setTakesPointer
  })
  useEffect(() => {
    // The input a real-input gesture took, until it hands it back. A gesture
    // that never does (the server went away) hands it back on its own.
    let taken: {
      release(): void
      timer: ReturnType<typeof setTimeout>
    } | null = null
    const release = () => {
      if (!taken) return
      clearTimeout(taken.timer)
      taken.release()
      taken = null
    }
    const page = async (ask: PageAsk): Promise<unknown> => {
      if (ask.kind === "release") return release()
      if (ask.kind !== "take") return dom.drivePage(ask)
      release()
      const iframe = iframeRef.current
      if (!iframe) return null
      const got = await takeFrameInput(iframe, ask.at, (on) =>
        setTakesPointerRef.current?.(on)
      )
      taken = {
        release: got.release,
        timer: setTimeout(release, TAKEN_INPUT_MAX_MS),
      }
      return { window: got.window }
    }
    const unregister = driveFrames.register(frameId, {
      drive: (op) => dom.drive(op),
      stop: () => dom.stopDrive(),
      where: () => {
        const r = iframeRef.current?.getBoundingClientRect()
        return {
          rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
          window: { width: window.innerWidth, height: window.innerHeight },
          zoom: zoomRef.current,
          visibility: document.visibilityState,
        }
      },
      ...(snapshot ? { snapshot: () => dom.pageSnapshot() } : {}),
      page,
    })
    return () => {
      release()
      unregister()
    }
  }, [frameId, dom, iframeRef, snapshot])
}
