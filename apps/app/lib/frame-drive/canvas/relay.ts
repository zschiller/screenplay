import {
  isDriveOp,
  isGesture,
  type DriveOp,
  type DriveResult,
} from "@/lib/frame-drive/contract"
import type {
  CanvasToServer,
  FrameWhere,
  PageAsk,
  PageInView,
  ServerToCanvas,
} from "@/lib/frame-drive/canvas/protocol"
import { PAGE_UNSUPPORTED } from "@/lib/frame-drive/canvas/protocol"

/**
 * The canvas's half of the asker's-canvas channel (#1389, `channel.ts`): it
 * takes an op from the server, checks Frame Control in this canvas (the person may have taken the
 * frame since the agent asked), and hands the op to the frame's Sandbox
 * Bridge. Frames and mockups (#1391) alike: both run the bridge. The socket
 * is the Mac sidecar's WebSocket, or on hosted the Room's doc (`view/`).
 * React-free, so each backend's contract suite runs it in a test page.
 */

/** A frame the relay can drive: its bridge, and where it sits on screen. */
export interface RelayFrame {
  /** Run one op through the frame's Sandbox Bridge. */
  drive(op: DriveOp): Promise<DriveResult>
  /** End a gesture the bridge is still running (someone took control). */
  stop(): void
  where(): FrameWhere
  /** The page as it is now, for a screenshot taken away from the canvas
   *  (hosted mockups). */
  snapshot?(): Promise<PageInView | null>
  /** One step of a gesture the Mac plays with real input (#1385); see
   *  {@link PageAsk}. Null when the bridge didn't answer. */
  page?(ask: PageAsk): Promise<unknown>
}

export interface RelayFrames {
  get(frameId: string): RelayFrame | undefined
  ids(): string[]
  /** Called whenever frames mount or unmount. */
  subscribe(listener: () => void): () => void
}

export interface RelayDeps {
  frames: RelayFrames
  /** Whether the agent drives `frameId` in this canvas, per Frame Control. */
  agentDrives(frameId: string): boolean
  /** Called whenever Frame Control changes. */
  subscribeControl(listener: () => void): () => void
  /**
   * Bring a frame into this canvas's view (#1390); false when the canvas has
   * no such frame. A frame the agent just opened may not be laid out yet, so
   * this may wait for it.
   */
  reveal?(frameId: string): Promise<boolean>
}

/** A socket the relay talks over: the browser's WebSocket, or a test's. */
export interface RelaySocket {
  send(data: string): void
  close(): void
  addEventListener(type: "open" | "close", listener: () => void): void
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void
  ): void
}

/** Answer one message from the server. */
export async function answerRelayMessage(
  message: ServerToCanvas,
  deps: Pick<RelayDeps, "frames" | "agentDrives" | "reveal">,
  running: Map<string, number>
): Promise<CanvasToServer> {
  if (message.type === "reveal") {
    const ok = deps.reveal
      ? await deps.reveal(message.frameId).catch(() => false)
      : false
    return { type: "revealed", id: message.id, ok }
  }
  const frame = deps.frames.get(message.frameId)
  if (message.type === "snapshot") {
    const snapshot = await frame?.snapshot?.().catch(() => null)
    return { type: "snapshot", id: message.id, snapshot: snapshot ?? null }
  }
  if (message.type === "page") {
    const ask = message.ask
    const answer = (value: unknown): CanvasToServer => ({
      type: "page",
      id: message.id,
      value,
    })
    // The server plays the gesture through the bridge instead.
    if (!frame?.page || !ask || typeof ask !== "object")
      return answer(PAGE_UNSUPPORTED)
    // Reading the page and handing input back need no control; anything that
    // moves toward the page does.
    const moves = ask.kind !== "state" && ask.kind !== "release"
    if (moves && !deps.agentDrives(message.frameId)) return answer("taken")
    if (ask.kind === "cursor")
      running.set(message.frameId, (running.get(message.frameId) ?? 0) + 1)
    try {
      return answer(await frame.page(ask).catch(() => null))
    } finally {
      if (ask.kind === "cursor") {
        const left = (running.get(message.frameId) ?? 1) - 1
        if (left > 0) running.set(message.frameId, left)
        else running.delete(message.frameId)
      }
    }
  }
  if (message.type === "where") {
    return {
      type: "where",
      id: message.id,
      where: frame?.where() ?? {
        rect: null,
        window: { width: 0, height: 0 },
        zoom: 1,
        visibility: "visible",
      },
    }
  }
  const result = async (): Promise<DriveResult> => {
    // Only the contract's ops ever reach a frame.
    if (!isDriveOp(message.op)) {
      return { status: "failed", reason: "unknown drive op" }
    }
    if (!frame) {
      return {
        status: "unavailable",
        reason: "This frame isn’t loaded on the open canvas.",
      }
    }
    if (isGesture(message.op) && !deps.agentDrives(message.frameId)) {
      return { status: "taken" }
    }
    running.set(message.frameId, (running.get(message.frameId) ?? 0) + 1)
    try {
      return await frame.drive(message.op)
    } finally {
      const left = (running.get(message.frameId) ?? 1) - 1
      if (left > 0) running.set(message.frameId, left)
      else running.delete(message.frameId)
    }
  }
  return { type: "result", id: message.id, result: await result() }
}

/**
 * Run the relay over `socket` until `close()`: report the mounted frames,
 * answer every op, and stop a running gesture the moment Frame Control moves
 * the frame away from the agent.
 */
export function runFrameDriveRelay(
  socket: RelaySocket,
  deps: RelayDeps
): { close(): void } {
  const running = new Map<string, number>()
  let open = false

  const reportFrames = () => {
    if (!open) return
    const message: CanvasToServer = {
      type: "frames",
      frameIds: deps.frames.ids(),
    }
    socket.send(JSON.stringify(message))
  }
  socket.addEventListener("open", () => {
    open = true
    reportFrames()
  })
  socket.addEventListener("close", () => {
    open = false
  })
  socket.addEventListener("message", (event) => {
    let message: ServerToCanvas
    try {
      message = JSON.parse(String(event.data)) as ServerToCanvas
    } catch {
      return
    }
    if (!message || typeof message.id !== "string") return
    void answerRelayMessage(message, deps, running).then((answer) => {
      if (open) socket.send(JSON.stringify(answer))
    })
  })

  const unsubscribeFrames = deps.frames.subscribe(reportFrames)
  const unsubscribeControl = deps.subscribeControl(() => {
    for (const frameId of running.keys()) {
      if (!deps.agentDrives(frameId)) deps.frames.get(frameId)?.stop()
    }
  })

  return {
    close() {
      unsubscribeFrames()
      unsubscribeControl()
      socket.close()
    },
  }
}

/** The mounted frames and mockups, registered by each Iframe and Mockup
 *  Layer. */
export function createRelayFrames(): RelayFrames & {
  register(frameId: string, frame: RelayFrame): () => void
} {
  const frames = new Map<string, RelayFrame>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    get: (frameId) => frames.get(frameId),
    ids: () => [...frames.keys()],
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    register(frameId, frame) {
      frames.set(frameId, frame)
      notify()
      return () => {
        if (frames.get(frameId) !== frame) return
        frames.delete(frameId)
        notify()
      }
    },
  }
}

/** This canvas's frames, for the relay and the Iframe Layers. */
export const driveFrames = createRelayFrames()
