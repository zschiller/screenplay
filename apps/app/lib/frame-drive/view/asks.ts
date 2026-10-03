import type {
  CanvasAnswer,
  CanvasToServer,
  ServerToCanvas,
} from "@/lib/frame-drive/mac/protocol"
import type { RelaySocket } from "@/lib/frame-drive/mac/relay"

/**
 * The drive channel to one person's own canvas on hosted (#1391), where no
 * WebSocket reaches the browser: a mockup has no Sandbox, so the agent drives
 * it in the asker's view. The server writes each message to the Room's doc as
 * an ask addressed to the asker (`frameDriveAsks`); their canvas runs it
 * through the same relay the Mac uses, posts the answer to the answer route,
 * and clears the ask. Everyone else's canvas ignores it, so they keep their
 * own copy of the mockup.
 */

/** One message waiting for the asker's canvas. Keyed by the message's id. */
export type FrameDriveAsk = {
  /** The person whose canvas answers it: the one who asked the agent. */
  viewer: string
  message: ServerToCanvas
  /** When the server wrote it (ms). */
  at: number
}

/** How long an ask stands before its canvas no longer runs it: the server
 *  has given up on it by then. */
export const FRAME_DRIVE_ASK_TTL_MS = 20_000

/** Where the asker's canvas posts an answer. */
export const FRAME_DRIVE_ANSWER_PATH = "/api/frame-drive/answer"

/** The answer route's body. */
export type FrameDriveAnswerBody = {
  room: string
  answer: CanvasAnswer
}

/** The asks in the Room's doc, as the canvas reads and clears them. */
export interface FrameDriveAskStore {
  entries(): ReadonlyMap<string, FrameDriveAsk>
  delete(id: string): void
  observe(listener: () => void): () => void
}

/**
 * A {@link RelaySocket} over the Room's doc, for `runFrameDriveRelay`: each
 * ask addressed to `viewerId` arrives as a message, and each answer goes to
 * `post` and clears its ask. An answer the route can't take is dropped: the
 * server times the op out and says so.
 */
export function docRelaySocket(opts: {
  asks: FrameDriveAskStore
  viewerId: string
  post: (answer: CanvasAnswer) => Promise<void>
  now?: () => number
}): RelaySocket {
  const now = opts.now ?? Date.now
  const listeners = {
    open: new Set<() => void>(),
    close: new Set<() => void>(),
    message: new Set<(event: { data: unknown }) => void>(),
  }
  const seen = new Set<string>()
  let unobserve: (() => void) | null = null
  let closed = false

  const deliver = () => {
    if (closed) return
    const entries = opts.asks.entries()
    for (const id of seen) if (!entries.has(id)) seen.delete(id)
    for (const [id, ask] of entries) {
      if (seen.has(id) || ask.viewer !== opts.viewerId) continue
      seen.add(id)
      // Left over from a turn that gave up on it: clear it, don't run it.
      if (now() - ask.at > FRAME_DRIVE_ASK_TTL_MS) {
        opts.asks.delete(id)
        continue
      }
      const data = JSON.stringify(ask.message)
      listeners.message.forEach((listener) => listener({ data }))
    }
  }

  // Open on the next tick, as a socket does: the relay subscribes first.
  queueMicrotask(() => {
    if (closed) return
    listeners.open.forEach((listener) => listener())
    unobserve = opts.asks.observe(deliver)
    deliver()
  })

  return {
    send(data) {
      if (closed) return
      let answer: CanvasToServer
      try {
        answer = JSON.parse(data) as CanvasToServer
      } catch {
        return
      }
      // The frames this canvas shows only matter to the Mac's sidecar.
      if (answer.type === "frames") return
      opts.asks.delete(answer.id)
      void opts.post(answer).catch(() => {})
    },
    close() {
      if (closed) return
      closed = true
      unobserve?.()
      listeners.close.forEach((listener) => listener())
    },
    addEventListener(
      type: "open" | "close" | "message",
      listener: ((event: { data: unknown }) => void) | (() => void)
    ) {
      if (type === "message") {
        listeners.message.add(listener as (event: { data: unknown }) => void)
      } else {
        listeners[type].add(listener as () => void)
      }
    },
  } as RelaySocket
}
