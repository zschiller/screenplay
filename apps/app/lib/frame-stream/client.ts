/**
 * The canvas side of a Workspace's Frame Stream (#1392): one WebSocket per
 * Workspace, shared by every frame of it this viewer watches. React-free; the
 * frame view (`components/canvas/frame-stream-view.tsx`) subscribes to it.
 *
 * - Asks the app where the stream is (`/api/frame-stream`), which also says
 *   whether the Workspace's frames are shared at all.
 * - Authenticates with the view token as its first message.
 * - Reconnects with backoff, watching again what it watched. A Sandbox that
 *   hibernated comes back with a fresh service, and each frame reloads at the
 *   route its viewers send.
 */

import { withBasePath } from "@/lib/base-path"
import {
  decodeVideoMessage,
  type FrameStreamClientMessage,
  type FrameStreamServerMessage,
  type FrameStreamVideo,
} from "@/lib/frame-stream/protocol"

export type FrameStreamEndpoint =
  { shared: true; url: string; token: string } | { shared: false }

/** Whether a Workspace's frames are shared: unknown until the app answers. */
export type FrameStreamAvailability = "checking" | "shared" | "unshared"

export type FrameWatch = {
  route: string
  width: number
  height: number
}

export type FrameStreamHandlers = {
  onMessage(msg: FrameStreamServerMessage): void
  onVideo(video: FrameStreamVideo): void
  /** The connection dropped or came back; `ready` is true once it can carry
   *  messages again. */
  onConnection?(ready: boolean): void
}

type SocketLike = {
  binaryType: string
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
}

export type FrameStreamDeps = {
  fetchEndpoint(): Promise<FrameStreamEndpoint>
  openSocket(url: string): SocketLike
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

const MAX_BACKOFF_MS = 10_000
// A Workspace whose stream the app can't set up after this many tries keeps
// per-viewer frames rather than leaving them blank.
const MAX_CHECK_FAILURES = 4

export class FrameStreamConnection {
  availability: FrameStreamAvailability = "checking"
  /** The stream's codec, from the service's `ready`. */
  codec: "h264" | "vp8" = "h264"
  private availabilityListeners = new Set<() => void>()
  private connectionListeners = new Set<(ready: boolean) => void>()
  private watches = new Map<
    string,
    { watch: FrameWatch; handlers: Set<FrameStreamHandlers> }
  >()
  private socket: SocketLike | null = null
  private ready = false
  private connecting = false
  private attempts = 0
  private retryTimer: unknown = null
  private checked = false
  private disposed = false

  constructor(private deps: FrameStreamDeps) {}

  // ---- availability ----

  /** Ask the app once whether this Workspace's frames are shared. */
  check(): void {
    if (this.checked) return
    this.checked = true
    void this.connect()
  }

  subscribeAvailability(listener: () => void): () => void {
    this.availabilityListeners.add(listener)
    return () => this.availabilityListeners.delete(listener)
  }

  private setAvailability(next: FrameStreamAvailability) {
    if (this.availability === next) return
    this.availability = next
    for (const l of this.availabilityListeners) l()
  }

  /** Hear when the stream comes up or drops (a drive grant doesn't survive
   *  a reconnect). */
  subscribeConnection(listener: (ready: boolean) => void): () => void {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  // ---- frames ----

  /** Stream a frame to `handlers` until the returned function is called. */
  watch(
    frame: string,
    watch: FrameWatch,
    handlers: FrameStreamHandlers
  ): () => void {
    let entry = this.watches.get(frame)
    if (!entry) {
      entry = { watch, handlers: new Set() }
      this.watches.set(frame, entry)
      if (this.ready) this.send({ t: "watch", frame, ...watch })
    }
    entry.handlers.add(handlers)
    this.check()
    return () => {
      const current = this.watches.get(frame)
      if (!current) return
      current.handlers.delete(handlers)
      if (current.handlers.size) return
      this.watches.delete(frame)
      if (this.ready) this.send({ t: "unwatch", frame })
    }
  }

  /** Keep what a reconnect watches with current; sends the change too. */
  update(frame: string, patch: Partial<FrameWatch>): void {
    const entry = this.watches.get(frame)
    if (!entry) return
    const before = entry.watch
    entry.watch = { ...before, ...patch }
    if (!this.ready) return
    if (
      patch.width !== undefined &&
      patch.height !== undefined &&
      (patch.width !== before.width || patch.height !== before.height)
    ) {
      this.send({ t: "size", frame, width: patch.width, height: patch.height })
    }
    if (patch.route !== undefined && patch.route !== before.route) {
      this.send({ t: "navigate", frame, route: patch.route })
    }
  }

  /** Send a message; dropped while disconnected. True when it went out. */
  send(msg: FrameStreamClientMessage): boolean {
    if (!this.ready || !this.socket) return false
    this.socket.send(JSON.stringify(msg))
    return true
  }

  isReady(): boolean {
    return this.ready
  }

  dispose(): void {
    this.disposed = true
    this.deps.clearTimeout(this.retryTimer)
    this.socket?.close()
    this.socket = null
    this.ready = false
  }

  // ---- connection ----

  private async connect(): Promise<void> {
    if (this.connecting || this.socket || this.disposed) return
    this.connecting = true
    let endpoint: FrameStreamEndpoint
    try {
      endpoint = await this.deps.fetchEndpoint()
    } catch {
      this.connecting = false
      if (
        this.availability === "checking" &&
        this.attempts + 1 >= MAX_CHECK_FAILURES
      ) {
        this.setAvailability("unshared")
        return
      }
      this.scheduleRetry()
      return
    }
    this.connecting = false
    if (this.disposed) return
    if (!endpoint.shared) {
      this.setAvailability("unshared")
      return
    }
    this.setAvailability("shared")
    const socket = this.deps.openSocket(endpoint.url)
    socket.binaryType = "arraybuffer"
    this.socket = socket
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: "auth", token: endpoint.token }))
    }
    socket.onmessage = (ev) => this.onSocketMessage(ev.data)
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      const wasReady = this.ready
      this.ready = false
      if (wasReady) this.notifyConnection(false)
      this.scheduleRetry()
    }
  }

  private scheduleRetry() {
    if (this.disposed) return
    const delay = Math.min(500 * 2 ** this.attempts, MAX_BACKOFF_MS)
    this.attempts++
    this.deps.clearTimeout(this.retryTimer)
    this.retryTimer = this.deps.setTimeout(() => void this.connect(), delay)
  }

  private onSocketMessage(data: unknown) {
    if (typeof data !== "string") {
      const buf =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : null
      const video = buf ? decodeVideoMessage(buf) : null
      if (!video) return
      for (const h of this.watches.get(video.frame)?.handlers ?? [])
        h.onVideo(video)
      return
    }
    let msg: FrameStreamServerMessage
    try {
      msg = JSON.parse(data) as FrameStreamServerMessage
    } catch {
      return
    }
    if (msg.t === "ready") {
      this.codec = msg.codec
      this.ready = true
      this.attempts = 0
      for (const [frame, { watch }] of this.watches) {
        this.send({ t: "watch", frame, ...watch })
      }
      this.notifyConnection(true)
      return
    }
    const frame = "frame" in msg ? msg.frame : undefined
    if (!frame) return
    for (const h of this.watches.get(frame)?.handlers ?? []) h.onMessage(msg)
  }

  private notifyConnection(ready: boolean) {
    for (const l of this.connectionListeners) l(ready)
    for (const { handlers } of this.watches.values()) {
      for (const h of handlers) h.onConnection?.(ready)
    }
  }
}

// ---- one connection per Workspace ----

const connections = new Map<string, FrameStreamConnection>()

/** The Workspace's Frame Stream, shared by every frame of it on the canvas. */
export function frameStreamFor(
  roomId: string,
  branchId: string
): FrameStreamConnection {
  const key = `${roomId}:${branchId}`
  let conn = connections.get(key)
  if (!conn) {
    conn = new FrameStreamConnection({
      fetchEndpoint: async () => {
        const res = await fetch(withBasePath("/api/frame-stream"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room: roomId, branchId }),
        })
        if (!res.ok) throw new Error(`frame stream: ${res.status}`)
        return (await res.json()) as FrameStreamEndpoint
      },
      openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    })
    connections.set(key, conn)
  }
  return conn
}

/** Ask the app for a drive grant for a frame this viewer drives. */
export async function fetchDriveToken(
  roomId: string,
  frame: string
): Promise<string | null> {
  const res = await fetch(withBasePath("/api/frame-stream/drive"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: roomId, frame }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { token?: string }
  return body.token ?? null
}
