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
 * - Hands out a handle per frame (`frame(id)`) that owns everything the
 *   canvas does to it: watching, driving, input, reload. Nothing outside
 *   this module sends raw wire messages.
 * - Keeps the drive grant of each frame this viewer drives fresh, and sends
 *   it again whenever it watches the frame again: the service forgets a
 *   driver who stops watching (a hidden tab, a frame scrolled away, a
 *   reconnect).
 */

import { withBasePath } from "@/lib/base-path"
import type { BridgePort } from "@/lib/bridge-port"
import {
  clickCounter,
  decodeVideoMessage,
  modifiersOf,
  mouseButtonOf,
  pageKeyOf,
  type FrameColorScheme,
  type FrameSnapshot,
  type FrameStreamClientMessage,
  type FrameStreamInput,
  type FrameStreamServerMessage,
  type FrameStreamVideo,
} from "@/lib/frame-stream/protocol"
import type { IframeToCanvasMessage } from "@/lib/postmessage-protocol"

export type FrameStreamEndpoint =
  | { shared: true; url: string; token: string }
  | { shared: false; reason?: string }

/** Whether a Workspace's frames are shared: unknown until the app answers. */
export type FrameStreamAvailability = "checking" | "shared" | "unshared"

export type FrameWatch = {
  route: string
  width: number
  height: number
  scheme?: FrameColorScheme
  /** A Mockup's page (#1523), shown in place of the app. */
  doc?: string
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
  /** A drive grant the app signs for this viewer and frame, or null when
   *  Frame Control doesn't say they drive it (yet). */
  fetchDriveToken(frame: string): Promise<string | null>
  /** Hear when the tab shows again. */
  onVisible(listener: () => void): () => void
  openSocket(url: string): SocketLike
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

/** One frame of the Workspace's stream, as this viewer uses it. */
export type FrameStreamFrame = {
  /** Stream the frame to `handlers` until the returned function is called. */
  watch(watch: FrameWatch, handlers: FrameStreamHandlers): () => void
  /** The frame's size, the room's route, its colour scheme or a Mockup's
   *  page changed. */
  update(patch: Partial<FrameWatch>): void
  /**
   * Drive the frame until the returned function is called: asks the app for
   * a grant, keeps it fresh, and asks again after a reconnect or when the
   * tab shows.
   */
  drive(): () => void
  /** Reload the shared page. False while the stream is down. */
  reload(): boolean
  /** Turn a driver's DOM events into the page's input, while they interact. */
  input(surface: () => FrameSurface, options?: { mac?: boolean }): FrameInput
  /**
   * Wait for the frame's first picture after going live (#1520): null once a
   * picture arrives, or why none came. Listens without watching; the frame's
   * view watches it.
   */
  firstPicture(): Promise<GoLiveFailure | null>
}

/**
 * Why a frame going live showed no picture: the stream never came up (the
 * Workspace's Sandbox didn't answer), the browser failed to start, or no
 * picture came in time.
 */
export type GoLiveFailure = "unreachable" | "failed" | "timeout"

/** Where the picture is on screen, and the page's CSS size it shows. */
export type FrameSurface = {
  rect: { left: number; top: number; width: number; height: number }
  width: number
  height: number
}

type Modifiers = {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}
type Cancelable = { preventDefault(): void; stopPropagation(): void }
type PointerLike = Modifiers & {
  button: number
  buttons: number
  clientX: number
  clientY: number
  timeStamp: number
}
type WheelLike = Modifiers &
  Cancelable & {
    clientX: number
    clientY: number
    deltaX: number
    deltaY: number
  }
type KeyLike = Modifiers &
  Cancelable & {
    key: string
    code: string
    keyCode: number
    repeat: boolean
    isComposing: boolean
  }
type ClipboardLike = {
  type: string
  preventDefault(): void
  clipboardData: { getData(type: string): string } | null
}

/** A driver's DOM events, sent to the page as its input. */
export type FrameInput = {
  pointer(
    type: "mousePressed" | "mouseReleased" | "mouseMoved",
    e: PointerLike
  ): void
  wheel(e: WheelLike): void
  key(type: "keyDown" | "keyUp", e: KeyLike): void
  paste(e: ClipboardLike): void
  /** Copy or cut what the page has selected: the text for this viewer's own
   *  clipboard, or null when there's none. */
  copy(e: ClipboardLike): Promise<string | null>
}

const MAX_BACKOFF_MS = 10_000
// A Workspace whose stream the app can't set up after this many tries keeps
// per-viewer frames rather than leaving them blank.
const MAX_CHECK_FAILURES = 4
// How long going local waits for the shared page's cookies and storage
// before it opens the local copy without them.
const SNAPSHOT_TIMEOUT_MS = 5000
// How long going live waits for the first picture. A cold browser takes
// about half a second, six at once up to four; a hibernated Sandbox wakes
// first.
const FIRST_PICTURE_TIMEOUT_MS = 30_000
// A drive grant lasts a minute; ask for the next one well before.
const DRIVE_REFRESH_MS = 30_000
// Frame Control's record can reach the server a moment after this viewer
// wrote it, so a refused grant is asked for again a few times.
const DRIVE_RETRY_MS = [0, 300, 800, 2000]

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
  /** The drive grant for each frame this viewer drives. */
  private grants = new Map<string, string>()
  /** Who waits for each frame's first picture (#1520). */
  private pictureWaiters = new Map<
    string,
    Set<(failure: GoLiveFailure | null) => void>
  >()
  /** Frames watched now that have had a picture since they were watched: a
   *  frame going live again before its view went away (#1520). */
  private pictured = new Set<string>()
  private bridgeListeners = new Map<
    string,
    Set<(message: IframeToCanvasMessage) => void>
  >()
  private socket: SocketLike | null = null
  private ready = false
  private connecting = false
  private attempts = 0
  private retryTimer: unknown = null
  private checked = false
  private disposed = false
  private snapshotSeq = 0
  private snapshots = new Map<string, (s: FrameSnapshot | null) => void>()
  private clipboards = new Map<string, (text: string | null) => void>()
  private frames = new Map<string, FrameStreamFrame>()

  constructor(private deps: FrameStreamDeps) {}

  /** The handle for one frame of this Workspace. */
  frame(frame: string): FrameStreamFrame {
    let handle = this.frames.get(frame)
    if (!handle) {
      handle = {
        watch: (watch, handlers) => this.watch(frame, watch, handlers),
        update: (patch) => this.update(frame, patch),
        drive: () => this.startDriving(frame),
        reload: () => this.send({ t: "reload", frame }),
        input: (surface, options) => this.input(frame, surface, options),
        firstPicture: () => this.firstPicture(frame),
      }
      this.frames.set(frame, handle)
    }
    return handle
  }

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
      if (this.ready) this.sendWatch(frame, watch)
    }
    entry.handlers.add(handlers)
    this.check()
    return () => {
      const current = this.watches.get(frame)
      if (!current) return
      current.handlers.delete(handlers)
      if (current.handlers.size) return
      this.watches.delete(frame)
      this.pictured.delete(frame)
      if (this.ready) this.send({ t: "unwatch", frame })
    }
  }

  /**
   * Drive a frame with a grant the app signed. The service applies a driver's
   * input only while they watch the frame, so the grant goes out now if this
   * viewer watches it, and again each time it watches it later.
   */
  private grant(frame: string, token: string): void {
    this.grants.set(frame, token)
    if (this.watches.has(frame)) this.send({ t: "drive", frame, token })
  }

  /** Keep a grant for a frame until the returned function is called. */
  private startDriving(frame: string): () => void {
    let run = 0
    let refresh: unknown = null
    const sleep = (ms: number) =>
      new Promise<void>((r) => this.deps.setTimeout(r, ms))
    // Each run supersedes the one before (a reconnect starts a new one).
    const ask = async () => {
      const mine = ++run
      this.deps.clearTimeout(refresh)
      // The grant rides the stream: once it's up, asking starts again.
      if (!this.ready) return
      const current = () => mine === run
      for (const wait of DRIVE_RETRY_MS) {
        if (wait) await sleep(wait)
        if (!current()) return
        const token = await this.deps.fetchDriveToken(frame).catch(() => null)
        if (!current()) return
        if (token && this.ready) {
          this.grant(frame, token)
          break
        }
      }
      refresh = this.deps.setTimeout(() => void ask(), DRIVE_REFRESH_MS)
    }
    void ask()
    // A reconnect may have outlasted the grant: ask again.
    const unsubscribe = this.subscribeConnection((ready) => {
      if (ready) void ask()
    })
    // A hidden tab's timers may not have kept the grant fresh: ask again
    // when it shows.
    const offVisible = this.deps.onVisible(() => void ask())
    return () => {
      run++
      unsubscribe()
      offVisible()
      this.deps.clearTimeout(refresh)
      this.grants.delete(frame)
      this.send({ t: "release", frame })
    }
  }

  private input(
    frame: string,
    surface: () => FrameSurface,
    { mac = isMac() }: { mac?: boolean } = {}
  ): FrameInput {
    const send = (input: FrameStreamInput) =>
      this.send({ t: "input", frame, ...input })
    // Client pixels to the page's CSS pixels: the picture is drawn at the
    // page's size inside the zoomed world.
    const at = (e: { clientX: number; clientY: number }) => {
      const { rect, width, height } = surface()
      return {
        x: ((e.clientX - rect.left) * width) / rect.width,
        y: ((e.clientY - rect.top) * height) / rect.height,
      }
    }
    const countClick = clickCounter()
    let clickCount = 1
    return {
      pointer: (type, e) => {
        if (type === "mousePressed")
          clickCount = countClick(e.button, e.clientX, e.clientY, e.timeStamp)
        send({
          kind: "mouse",
          type,
          ...at(e),
          button: type === "mouseMoved" ? "none" : mouseButtonOf(e.button),
          buttons: e.buttons,
          clickCount: type === "mouseMoved" ? 0 : clickCount,
          modifiers: modifiersOf(e),
        })
      },
      wheel: (e) => {
        // Cmd/Ctrl+wheel still zooms the canvas.
        if (e.ctrlKey || e.metaKey) return
        e.preventDefault()
        e.stopPropagation()
        send({
          kind: "wheel",
          ...at(e),
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          modifiers: modifiersOf(e),
        })
      },
      key: (type, e) => {
        // Keys belong to the page, not the canvas's shortcuts. Esc goes to
        // both: the page sees it, and the canvas leaves Interact.
        if (e.key !== "Escape") e.stopPropagation()
        // Copy, cut and paste go as their events, with this viewer's own
        // clipboard: the shortcuts would use the shared browser's.
        if (
          (e.metaKey || e.ctrlKey) &&
          !e.altKey &&
          ["KeyC", "KeyX", "KeyV"].includes(e.code)
        )
          return
        if (e.key !== "Escape") e.preventDefault()
        if (e.isComposing) return
        const text =
          type === "keyDown" && !e.metaKey && !e.ctrlKey
            ? e.key === "Enter"
              ? "\r"
              : e.key.length === 1
                ? e.key
                : undefined
            : undefined
        send({
          kind: "key",
          type: type === "keyDown" && !text ? "rawKeyDown" : type,
          ...pageKeyOf(e, mac),
          text,
          repeat: e.repeat,
        })
      },
      paste: (e) => {
        const text = e.clipboardData?.getData("text/plain")
        if (!text) return
        e.preventDefault()
        send({ kind: "text", text })
      },
      copy: (e) => {
        e.preventDefault()
        return this.clipboard(frame, e.type === "cut")
      },
    }
  }

  private firstPicture(frame: string): Promise<GoLiveFailure | null> {
    // Still watched from before, with a picture showing: a still page sends
    // no new one.
    if (this.pictured.has(frame)) return Promise.resolve(null)
    return new Promise((resolve) => {
      let waiters = this.pictureWaiters.get(frame)
      if (!waiters) {
        waiters = new Set()
        this.pictureWaiters.set(frame, waiters)
      }
      const timer = this.deps.setTimeout(
        () => finish(this.ready ? "timeout" : "unreachable"),
        FIRST_PICTURE_TIMEOUT_MS
      )
      const finish = (failure: GoLiveFailure | null) => {
        if (!waiters.delete(finish)) return
        if (!waiters.size) this.pictureWaiters.delete(frame)
        this.deps.clearTimeout(timer)
        resolve(failure)
      }
      waiters.add(finish)
    })
  }

  private settlePicture(frame: string, failure: GoLiveFailure | null) {
    for (const finish of [...(this.pictureWaiters.get(frame) ?? [])])
      finish(failure)
  }

  /** Watch a frame, with this viewer's drive grant for it if it drives it. */
  private sendWatch(frame: string, watch: FrameWatch) {
    this.send({ t: "watch", frame, ...watch })
    const token = this.grants.get(frame)
    if (token) this.send({ t: "drive", frame, token })
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
    if (patch.scheme !== undefined && patch.scheme !== before.scheme) {
      this.send({ t: "scheme", frame, scheme: patch.scheme })
    }
    if (patch.doc !== undefined && patch.doc !== before.doc) {
      this.send({ t: "doc", frame, doc: patch.doc })
    }
  }

  /**
   * The Sandbox Bridge in a shared frame's page (#1394), reached over the
   * stream instead of postMessage. Messages go out only while this viewer
   * watches the frame (the service ignores the rest), so a read of a frame
   * that's off screen fails at once rather than timing out.
   */
  bridgePort(frame: string): BridgePort {
    return {
      post: (message) =>
        this.watches.has(frame) && this.send({ t: "bridge", frame, message }),
      subscribe: (listener) => {
        let listeners = this.bridgeListeners.get(frame)
        if (!listeners) {
          listeners = new Set()
          this.bridgeListeners.set(frame, listeners)
        }
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) this.bridgeListeners.delete(frame)
        }
      },
    }
  }

  /** Send a message; dropped while disconnected. True when it went out. */
  private send(msg: FrameStreamClientMessage): boolean {
    if (!this.ready || !this.socket) return false
    this.socket.send(JSON.stringify(msg))
    return true
  }

  /**
   * The shared page's path, cookies and local storage, for going local
   * (#1397). Null when the stream is down, the page isn't live, or it takes
   * too long to answer.
   */
  snapshot(frame: string): Promise<FrameSnapshot | null> {
    const id = `${++this.snapshotSeq}`
    return new Promise((resolve) => {
      const timer = this.deps.setTimeout(
        () => finish(null),
        SNAPSHOT_TIMEOUT_MS
      )
      const finish = (s: FrameSnapshot | null) => {
        if (!this.snapshots.delete(id)) return
        this.deps.clearTimeout(timer)
        resolve(s)
      }
      this.snapshots.set(id, finish)
      if (!this.send({ t: "snapshot", frame, id })) finish(null)
    })
  }

  /**
   * Copy (or cut) what's selected in a shared page this viewer drives, as
   * text for its own clipboard. Null when nothing is selected, the stream is
   * down, or it takes too long to answer.
   */
  clipboard(frame: string, cut: boolean): Promise<string | null> {
    const id = `c${++this.snapshotSeq}`
    return new Promise((resolve) => {
      const timer = this.deps.setTimeout(
        () => finish(null),
        SNAPSHOT_TIMEOUT_MS
      )
      const finish = (text: string | null) => {
        if (!this.clipboards.delete(id)) return
        this.deps.clearTimeout(timer)
        resolve(text)
      }
      this.clipboards.set(id, finish)
      if (!this.send({ t: "clipboard", frame, id, cut })) finish(null)
    })
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
      for (const finish of [...this.snapshots.values()]) finish(null)
      for (const finish of [...this.clipboards.values()]) finish(null)
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
      if (this.watches.has(video.frame)) this.pictured.add(video.frame)
      this.settlePicture(video.frame, null)
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
        this.sendWatch(frame, watch)
      }
      this.notifyConnection(true)
      return
    }
    if (msg.t === "snapshot") {
      this.snapshots.get(msg.id)?.(
        "error" in msg
          ? null
          : {
              path: msg.path,
              cookies: msg.cookies,
              localStorage: msg.localStorage,
            }
      )
      return
    }
    if (msg.t === "clipboard") {
      this.clipboards.get(msg.id)?.(msg.text)
      return
    }
    const frame = "frame" in msg ? msg.frame : undefined
    if (!frame) return
    if (msg.t === "bridge") {
      for (const l of this.bridgeListeners.get(frame) ?? []) l(msg.message)
      return
    }
    if (msg.t === "frame" && msg.status === "failed")
      this.settlePicture(frame, "failed")
    for (const h of this.watches.get(frame)?.handlers ?? []) h.onMessage(msg)
  }

  private notifyConnection(ready: boolean) {
    if (!ready) this.pictured.clear()
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
      fetchDriveToken: (frame) => fetchDriveToken(roomId, frame),
      onVisible: (listener) => {
        const onChange = () => {
          if (document.visibilityState === "visible") listener()
        }
        document.addEventListener("visibilitychange", onChange)
        return () => document.removeEventListener("visibilitychange", onChange)
      },
      openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    })
    connections.set(key, conn)
  }
  return conn
}

function isMac(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  )
}

/** Ask the app for a drive grant for a frame this viewer drives. */
async function fetchDriveToken(
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
