import "server-only"

import type { IncomingMessage } from "node:http"
import type { RawData, WebSocket } from "ws"

import {
  isDriveOp,
  isGesture,
  type DriveScreenshotResult,
  type FrameDriveBackend,
} from "@/lib/frame-drive/contract"
import {
  runRealInput,
  type NativeInput,
} from "@/lib/frame-drive/mac/real-input"
import {
  askerCanvas,
  type AskerCanvas,
  type AskerCanvasTimeouts,
  type CanvasTransport,
} from "@/lib/frame-drive/canvas/channel"
import {
  FRAME_DRIVE_ROOM_PARAM,
  type CanvasAnswer,
  type CanvasToServer,
  type FrameWhere,
} from "@/lib/frame-drive/canvas/protocol"

/**
 * The sidecar's transport for the asker's-canvas channel on the Mac (#1389,
 * `canvas/channel.ts`): the canvases connected per Room, each over its own
 * WebSocket, and the Frame Drive backend that relays an op to the canvas
 * showing the frame, which applies it through the frame's Sandbox Bridge.
 *
 * A connection only gets here through the local Yjs server's gate (the
 * per-launch secret and the app's own Origin, `lib/local-ws-guard.ts`), so no
 * other page or process can stand in for the canvas.
 */

type Pending = {
  resolve: (answer: CanvasAnswer | string) => void
  timer: ReturnType<typeof setTimeout>
}

type Canvas = {
  socket: WebSocket
  frameIds: Set<string>
  pending: Map<string, Pending>
}

// On globalThis: the Yjs server (started from `instrumentation.ts`) and the
// routes that build the agent's tools can load this module in separate
// module graphs.
const REGISTRY_KEY = Symbol.for("screenplay.frameDriveCanvases")
type RegistryHost = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, Canvas[]>
}
function canvasesByRoom(): Map<string, Canvas[]> {
  const host = globalThis as RegistryHost
  host[REGISTRY_KEY] ??= new Map()
  return host[REGISTRY_KEY]
}

/** Take a canvas's drive connection, once the server's gate let it in. */
export function acceptFrameDriveConnection(
  socket: WebSocket,
  req: IncomingMessage
): void {
  const url = new URL(req.url ?? "/", "http://localhost")
  const roomId = url.searchParams.get(FRAME_DRIVE_ROOM_PARAM)
  if (!roomId) {
    socket.close(1008, "missing room")
    return
  }
  const canvas: Canvas = { socket, frameIds: new Set(), pending: new Map() }
  const rooms = canvasesByRoom()
  rooms.set(roomId, [...(rooms.get(roomId) ?? []), canvas])

  socket.on("message", (data: RawData) => {
    let message: CanvasToServer
    try {
      message = JSON.parse(String(data)) as CanvasToServer
    } catch {
      return
    }
    if (message.type === "frames") {
      canvas.frameIds = new Set(
        Array.isArray(message.frameIds) ? message.frameIds.map(String) : []
      )
      return
    }
    const pending = canvas.pending.get(message.id)
    if (!pending) return
    canvas.pending.delete(message.id)
    clearTimeout(pending.timer)
    pending.resolve(message)
  })
  socket.on("close", () => {
    const left = (rooms.get(roomId) ?? []).filter((c) => c !== canvas)
    if (left.length > 0) rooms.set(roomId, left)
    else rooms.delete(roomId)
    for (const pending of canvas.pending.values()) {
      clearTimeout(pending.timer)
      pending.resolve(CANVAS_CLOSED)
    }
    canvas.pending.clear()
  })
}

const NO_CANVAS =
  "Screenplay isn’t showing this canvas, so its frames can’t be used. The agent can use them only while the canvas is open in the Screenplay app (the window can be in the background)."
const NO_FRAME =
  "This frame isn’t loaded on the open canvas, so it can’t be used."
const CANVAS_CLOSED = "The canvas closed before the frame answered."
const NO_ANSWER = "The canvas didn’t answer in time."

/** The canvas showing `frameId`: the newest one, when several are open. */
function canvasFor(roomId: string, frameId: string): Canvas | null {
  const canvases = canvasesByRoom().get(roomId) ?? []
  for (let i = canvases.length - 1; i >= 0; i--) {
    if (canvases[i]!.frameIds.has(frameId)) return canvases[i]!
  }
  return null
}

/** Why no canvas in `roomId` shows `frameId`. */
function missing(roomId: string): string {
  return canvasesByRoom().get(roomId)?.length ? NO_FRAME : NO_CANVAS
}

/**
 * The Mac transport for one Room: each message goes to the newest canvas
 * showing the frame. On the Mac every canvas open on the Room is the asker's
 * own, so a reveal moves nobody else's view.
 */
export function macCanvasTransport(roomId: string): CanvasTransport {
  return {
    ask(message, timeoutMs) {
      const canvas = canvasFor(roomId, message.frameId)
      if (!canvas) return Promise.resolve(missing(roomId))
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          canvas.pending.delete(message.id)
          resolve(NO_ANSWER)
        }, timeoutMs)
        canvas.pending.set(message.id, { resolve, timer })
        canvas.socket.send(JSON.stringify(message))
      })
    },
  }
}

/** The asker's canvas for one Room on the Mac. */
export function macAskerCanvas(
  roomId: string,
  timeouts?: AskerCanvasTimeouts
): AskerCanvas {
  return askerCanvas(macCanvasTransport(roomId), timeouts)
}

/**
 * Snapshot the canvas window's webview, limited to `rect` (CSS px in the
 * window): the Mac shell's `takeSnapshot`, a PNG.
 */
export type NativeSnapshot = (rect: FrameWhere["rect"]) => Promise<Buffer>

/**
 * The Mac Frame Drive backend for one Room: ops go to the canvas showing the
 * frame; the screenshot is the shell's snapshot of that canvas, so it shows
 * the frame exactly as the person sees it, background window included. With
 * the shell's `native` input, a click, typing, a key or a hover lands as real
 * input (#1385, `real-input.ts`); without it (or where it can't land) the
 * frame's Sandbox Bridge plays it, gaps and all.
 */
export function macFrameDriveBackend(
  roomId: string,
  deps: {
    snapshot: NativeSnapshot
    /** Shrink and encode a snapshot for the model. */
    encode?: (
      png: Buffer,
      size: { width: number; height: number }
    ) => Promise<{
      data: Buffer
      mediaType: string
    }>
    opTimeoutMs?: number
    /** The desktop shell's real input. */
    native?: NativeInput
    /** The files a click names in the frame's Workspace, as absolute paths;
     *  null when any isn't one. */
    files?: (frameId: string, paths: string[]) => Promise<string[] | null>
  }
): FrameDriveBackend {
  const canvas = macAskerCanvas(roomId, { opTimeoutMs: deps.opTimeoutMs })
  // What the agent copied, for its own pastes: never the person's clipboard.
  const clipboard = { text: null as string | null }
  return {
    async unavailable(frameId) {
      if (!canvasesByRoom().get(roomId)?.length) return NO_CANVAS
      if (frameId === undefined) return null
      return canvasFor(roomId, frameId) ? null : NO_FRAME
    },

    async run(frameId, op) {
      const native = deps.native
      if (native && isDriveOp(op) && isGesture(op)) {
        const files = deps.files
        const real = await runRealInput(op, {
          page: (ask) => canvas.page(frameId, ask),
          native,
          files: files && ((paths) => files(frameId, paths)),
          clipboard,
        })
        if (real) return real
      }
      return canvas.run(frameId, op)
    },

    async screenshot(frameId): Promise<DriveScreenshotResult> {
      const where = await canvas.where(frameId)
      if (typeof where === "string")
        return { status: "unavailable", reason: where }
      if (!where.rect) return { status: "unavailable", reason: NO_FRAME }
      const shown = visiblePart(where.rect, where.window)
      if (!shown) {
        return {
          status: "unavailable",
          reason:
            "The frame is out of view on the canvas, so there’s nothing to photograph. Ask the person to bring it into view.",
        }
      }
      let png: Buffer
      try {
        png = await deps.snapshot(shown)
      } catch (err) {
        return {
          status: "unavailable",
          reason: `The Mac couldn’t snapshot the canvas: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
      const image = deps.encode
        ? await deps.encode(png, { width: shown.width, height: shown.height })
        : { data: png, mediaType: "image/png" }
      return {
        status: "shot",
        shot: { ...image, note: screenshotNote(where, shown) },
      }
    },
  }
}

/** The part of `rect` inside the window, or null when none is. */
export function visiblePart(
  rect: NonNullable<FrameWhere["rect"]>,
  window: FrameWhere["window"]
): NonNullable<FrameWhere["rect"]> | null {
  // Snap inward to whole points, so a fractional edge doesn't pull in a
  // sliver of the frame's border.
  const x = Math.ceil(Math.max(0, rect.x))
  const y = Math.ceil(Math.max(0, rect.y))
  const right = Math.floor(Math.min(window.width, rect.x + rect.width))
  const bottom = Math.floor(Math.min(window.height, rect.y + rect.height))
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}

function screenshotNote(
  where: FrameWhere,
  shown: NonNullable<FrameWhere["rect"]>
): string | undefined {
  const notes: string[] = []
  const rect = where.rect!
  if (shown.width < rect.width - 1 || shown.height < rect.height - 1) {
    notes.push(
      "Only part of the frame is in view on the canvas; this is that part."
    )
  }
  if (Math.abs(where.zoom - 1) > 0.01) {
    notes.push(`The canvas is at ${Math.round(where.zoom * 100)}% zoom.`)
  }
  if (where.visibility !== "visible") {
    notes.push(
      "The Screenplay window is hidden, so the picture may be out of date."
    )
  }
  return notes.length > 0 ? notes.join(" ") : undefined
}
