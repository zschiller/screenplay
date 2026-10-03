// Frame Stream (#1392): the shared browser behind every hosted frame.
//
// Runs inside a Workspace Sandbox next to the dev server. Each Iframe Layer
// gets one Chromium page on its own virtual X display, loading the bridge
// proxy on localhost. ffmpeg grabs the display and encodes it once (H.264),
// and this server fans the video out to every viewer over one WebSocket port
// per Workspace, which carries every frame in it. The canvas decodes with
// WebCodecs. WebRTC can't connect from a Vercel Sandbox (#1366).
//
// A frame nobody watches pauses (#1393): a few seconds after its last viewer
// leaves, capture and encoding stop and its page is frozen in the running
// browser, so it keeps its state. The next viewer gets the last picture at once, then the
// stream. Past a cap of running browsers, the least recently viewed paused
// frame closes its browser; viewed again, it reopens at its URL with its
// cookies and storage (in-memory state is lost).
//
// Only the frame's driver reaches the page: a viewer's input is applied
// through CDP only while it holds a drive grant the app signed for that
// frame, which the app hands out to whoever Frame Control says drives it.
//
// The page runs in an iframe inside a small host page this server serves, as
// it does on the canvas, so the Sandbox Bridge, Knobs and shared state talk
// to their parent as they always do (#1394). The host relays those messages
// to and from the viewers over the stream, in place of the canvas's
// postMessage: reads go back to whoever asked, and what writes to the room
// (state, Knobs, scroll) goes through one viewer, the frame's primary.
//
// No dependencies: it runs from /tmp/screenplay with Node's built-ins only,
// so the WebSocket server below is a minimal RFC 6455 implementation.
//
// Wire protocol (see lib/frame-stream/protocol.ts for the client side):
//   client → server, JSON text: auth, watch, unwatch, size, navigate,
//     reload, drive, release, input, bridge
//   server → client, JSON text: ready, frame, route, error, bridge
//   server → client, binary video: [1][flags][u16 id length][id][access unit]
//     flags bit 0: keyframe

import http from "node:http"
import { spawn } from "node:child_process"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { existsSync, mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PORT = Number(process.env.SCREENPLAY_STREAM_PORT) || 7682
const HOST = process.env.SCREENPLAY_STREAM_HOST || "0.0.0.0"
const KEY = process.env.SCREENPLAY_STREAM_KEY || ""
// The page every frame loads: the bridge proxy in front of the dev server.
const ORIGIN = (
  process.env.SCREENPLAY_FRAME_ORIGIN || "http://127.0.0.1:4000"
).replace(/\/+$/, "")
const CHROME = process.env.SCREENPLAY_CHROME || "google-chrome"
const FPS = Number(process.env.SCREENPLAY_STREAM_FPS) || 30
// Frames are encoded at twice their CSS size so they stay sharp up to 200%
// zoom, within a pixel budget per frame (larger frames encode at less).
const SCALE = Number(process.env.SCREENPLAY_STREAM_SCALE) || 2
const MAX_PIXELS =
  Number(process.env.SCREENPLAY_STREAM_MAX_PIXELS) || 2560 * 1600
const CODEC = process.env.SCREENPLAY_STREAM_CODEC === "vp8" ? "vp8" : "h264"
const FIRST_DISPLAY = Number(process.env.SCREENPLAY_STREAM_DISPLAY) || 90
// Each display is a fixed square; a frame's capture is its top-left corner.
const SCREEN = 4096
const AUTH_TIMEOUT_MS = 5000
const MAX_MESSAGE = 1 << 20
// A viewer this far behind skips to the next keyframe instead of buffering.
const MAX_BACKLOG = 8 << 20
const RESTART_DELAY_MS = 500
// How long a frame keeps encoding after its last viewer leaves, so a viewer
// scrolling past or reloading comes back to a running stream.
const IDLE_PAUSE_MS = Number(process.env.SCREENPLAY_STREAM_IDLE_MS) || 5000
// Browsers kept running per Workspace, paused or not. A paused frame holds
// about 500 MB (Chrome 370, its display 130) and a watched one 640 (ffmpeg
// adds 100); the 4 vCPU (8 GB) Sandbox also runs the dev server and the
// agent. Measurements are on #1393.
const MAX_BROWSERS = Number(process.env.SCREENPLAY_STREAM_MAX_FRAMES) || 6
// What closing a paused browser may wait on: its storage snapshot, then a
// clean exit that flushes its profile to disk.
const EVICT_TIMEOUT_MS = 3000
const PLACEHOLDER_RETRY_MS = 1000
// The host page's way out to this server (a CDP binding).
const BINDING = "__screenplayFrameHost"
// A page snapshot can be large; anything bigger is dropped.
const MAX_PAGE_MESSAGE = 16 << 20
// A bridge read the page never answered (it reloaded) is forgotten.
const REQUEST_TTL_MS = 30_000
// What a viewer may send the page. Reads come from anyone; what changes the
// page from the room's state comes only from the primary, so viewers echoing
// the same room change don't each apply it.
const BRIDGE_READS = new Set(["screenplay:dom-query"])
const BRIDGE_WRITES = new Set([
  "screenplay:init",
  "screenplay:state-update",
  "screenplay:scroll-to",
  "screenplay:knob-values",
  "screenplay:shared-state-apply",
])
// What the page reports that the room records: the primary hears it, once.
// The picker, gestures and navigation reports aren't relayed: a shared frame
// picks with reads, takes its input over CDP, and reports its route itself.
const PRIMARY_EVENTS = new Set([
  "screenplay:ready",
  "screenplay:state-changed",
  "screenplay:scroll",
  "screenplay:knobs-declared",
  "screenplay:shared-state",
  "screenplay:shared-state-request",
])

if (!KEY) {
  console.error("[frame-stream] SCREENPLAY_STREAM_KEY is not set")
  process.exit(1)
}

const log = (...args) => console.log("[frame-stream]", ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- tokens: base64url(JSON claims) "." base64url(HMAC-SHA256) ----------

function verifyToken(token) {
  if (typeof token !== "string") return null
  const dot = token.indexOf(".")
  if (dot < 1) return null
  const body = token.slice(0, dot)
  const sig = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(
    createHmac("sha256", KEY).update(body).digest("base64url")
  )
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected))
    return null
  let claims
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (!claims || typeof claims.exp !== "number" || claims.exp < Date.now())
    return null
  return claims
}

// ---------- WebSocket (server side of RFC 6455) ----------

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

class Connection {
  constructor(socket) {
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.fragments = null
    this.user = null
    this.watching = new Set()
    // Frames whose video this viewer fell behind on: skip to a keyframe.
    this.needsKey = new Set()
    this.closed = false
    socket.setNoDelay(true)
    socket.on("data", (d) => this.onData(d))
    socket.on("close", () => this.onClose())
    socket.on("error", () => socket.destroy())
    this.authTimer = setTimeout(() => {
      if (!this.user) this.close(4401)
    }, AUTH_TIMEOUT_MS)
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    for (;;) {
      if (this.buf.length < 2) return
      const b0 = this.buf[0]
      const b1 = this.buf[1]
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2))
        off = 10
      }
      if (len > MAX_MESSAGE) return this.close(1009)
      // Browsers always mask what they send.
      if (!(b1 & 0x80)) return this.close(1002)
      if (this.buf.length < off + 4 + len) return
      const mask = this.buf.subarray(off, off + 4)
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len))
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      this.buf = this.buf.subarray(off + 4 + len)
      this.onFrame(b0 & 0x80, b0 & 0x0f, payload)
      if (this.closed) return
    }
  }

  onFrame(fin, op, payload) {
    if (op === 0x8) return this.close(1000)
    if (op === 0x9) return this.write(0xa, payload)
    if (op === 0xa) return
    if (op === 0x0) {
      if (!this.fragments) return this.close(1002)
      this.fragments.push(payload)
      if (!fin) return
      const whole = Buffer.concat(this.fragments)
      this.fragments = null
      return this.onMessage(whole)
    }
    if (op === 0x1 || op === 0x2) {
      if (!fin) {
        this.fragments = [payload]
        return
      }
      return this.onMessage(payload)
    }
    this.close(1002)
  }

  onMessage(data) {
    let msg
    try {
      msg = JSON.parse(data.toString("utf8"))
    } catch {
      return
    }
    if (!msg || typeof msg !== "object") return
    if (!this.user) {
      const claims = msg.t === "auth" ? verifyToken(msg.token) : null
      if (!claims || claims.k !== "view") return this.close(4401)
      clearTimeout(this.authTimer)
      this.user = claims.sub
      this.sendJson({ t: "ready", codec: CODEC })
      return
    }
    handleMessage(this, msg).catch((e) => log("message failed:", e.message))
  }

  write(op, payload) {
    if (this.closed) return
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.from([0x80 | op, len])
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | op
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | op
      header[1] = 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    this.socket.cork()
    this.socket.write(header)
    this.socket.write(payload)
    this.socket.uncork()
  }

  sendJson(obj) {
    this.write(0x1, Buffer.from(JSON.stringify(obj)))
  }

  /** Video for one frame. A viewer that's too far behind drops pictures
   *  until the next keyframe, rather than falling further behind. */
  sendVideo(frameId, message, key) {
    if (this.closed) return
    if (this.needsKey.has(frameId)) {
      if (!key) return
      this.needsKey.delete(frameId)
    }
    if (this.socket.writableLength > MAX_BACKLOG) {
      this.needsKey.add(frameId)
      return
    }
    this.write(0x2, message)
  }

  close(code) {
    if (this.closed) return
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(code, 0)
    this.write(0x8, payload)
    this.closed = true
    this.socket.end()
    this.onClose()
  }

  onClose() {
    this.closed = true
    clearTimeout(this.authTimer)
    for (const id of this.watching) frames.get(id)?.removeViewer(this)
    this.watching.clear()
  }
}

// ---------- CDP over --remote-debugging-pipe ----------

function connectCdp(chrome) {
  const toChrome = chrome.stdio[3]
  const fromChrome = chrome.stdio[4]
  let seq = 0
  const pending = new Map()
  const listeners = new Set()
  let buf = ""
  fromChrome.on("data", (d) => {
    buf += d.toString("utf8")
    let end
    while ((end = buf.indexOf("\0")) >= 0) {
      const raw = buf.slice(0, end)
      buf = buf.slice(end + 1)
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        continue
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method) {
        for (const l of listeners) l(msg)
      }
    }
  })
  const failAll = () => {
    for (const { reject } of pending.values()) reject(new Error("closed"))
    pending.clear()
  }
  fromChrome.on("close", failAll)
  toChrome.on("error", failAll)
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, { resolve, reject })
        toChrome.write(
          JSON.stringify({ id, method, params, sessionId }) + "\0",
          (err) => {
            if (err) {
              pending.delete(id)
              reject(err)
            }
          }
        )
      })
    },
    on(listener) {
      listeners.add(listener)
    },
  }
}

// ---------- frames ----------

/** @type {Map<string, Frame>} */
const frames = new Map()
const usedDisplays = new Set()

function takeDisplay() {
  let n = FIRST_DISPLAY
  while (usedDisplays.has(n) || existsSync(`/tmp/.X${n}-lock`)) n++
  usedDisplays.add(n)
  return n
}

/** A route on the frame origin: a path, never another origin. */
function validRoute(route) {
  return (
    typeof route === "string" && route.startsWith("/") && route.length < 4096
  )
}

function validSize(n) {
  return Number.isFinite(n) && n >= 1 && n <= 16384
}

const AUD = Buffer.from([0, 0, 0, 1, 9])

class Frame {
  constructor(id, route, width, height) {
    this.id = id
    this.idBytes = Buffer.from(id, "utf8")
    this.path = route
    this.width = width
    this.height = height
    this.viewers = new Set()
    this.driver = null
    // The room route a navigation is under way to, so every viewer sending
    // it navigates once.
    this.navigatingTo = null
    this.status = "starting"
    this.generation = 0
    this.gop = []
    this.enc = null
    this.closed = false
    this.restarts = 0
    // ---- bridge relay ----
    // Reads in flight, by the id the page sees: who asked and their own id.
    this.requests = new Map()
    this.requestSeq = 0
    // The viewer the page's room-writing reports go to.
    this.primaryConn = null
    // The page's latest Knobs, and a shared-state request nobody was there
    // to answer: a new primary hears them, so it can push the room's values.
    this.knobs = null
    this.unanswered = null
    // The picture a paused frame shows its next viewer while encoding
    // resumes: the last group of pictures, from its keyframe.
    this.still = []
    this.idleTimer = null
    this.lastViewed = Date.now()
    // A closed (evicted) frame's cookies and storage, restored when it
    // reopens. Its profile directory is kept too.
    this.saved = null
    this.restoreScript = null
    this.evicting = false
    this.frozen = false
  }

  // ---- lifecycle ----

  async start() {
    const gen = ++this.generation
    this.setStatus(this.status === "live" ? "restarting" : this.status)
    this.display = takeDisplay()
    // An evicted frame reopens on the profile it closed with.
    this.userDataDir ??= mkdtempSync(join(tmpdir(), "screenplay-frame-"))
    this.xvfb = spawn(
      "Xvfb",
      [
        `:${this.display}`,
        "-screen",
        "0",
        `${SCREEN}x${SCREEN}x24`,
        "-nolisten",
        "tcp",
        "-ac",
      ],
      { stdio: "ignore" }
    )
    for (
      let i = 0;
      i < 50 && !existsSync(`/tmp/.X11-unix/X${this.display}`);
      i++
    )
      await sleep(50)
    if (gen !== this.generation) return
    const logical = Math.floor(SCREEN / SCALE)
    this.chrome = spawn(
      CHROME,
      [
        "--remote-debugging-pipe",
        `--user-data-dir=${this.userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-features=Translate,MediaRouter",
        "--disable-background-networking",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--password-store=basic",
        "--kiosk",
        "--window-position=0,0",
        `--window-size=${logical},${logical}`,
        `--force-device-scale-factor=${SCALE}`,
        "--disable-gpu",
        "--no-sandbox",
        "about:blank",
      ],
      {
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
        env: { ...process.env, DISPLAY: `:${this.display}` },
      }
    )
    const chrome = this.chrome
    chrome.on("exit", () => this.onBrowserExit(gen))
    this.cdp = connectCdp(chrome)
    const { targetInfos } = await this.cdp.send("Target.getTargets")
    const page = targetInfos.find((t) => t.type === "page")
    if (!page) throw new Error("no page target")
    const { sessionId } = await this.cdp.send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    })
    this.session = sessionId
    const { bounds } = await this.cdp.send("Browser.getWindowForTarget", {
      targetId: page.targetId,
    })
    this.maxPhysical = {
      width: Math.min(SCREEN, Math.floor(bounds.width * SCALE)),
      height: Math.min(SCREEN, Math.floor(bounds.height * SCALE)),
    }
    // The host page is the main frame; the app is its one iframe.
    const host = page.targetId
    this.appFrame = null
    // The binding reaches every script in the page, the app's included; only
    // the host's own calls, which passed its origin check, are relayed.
    this.hostContext = null
    this.requests.clear()
    this.knobs = null
    this.unanswered = null
    this.cdp.on((msg) => {
      if (msg.sessionId !== this.session) return
      const p = msg.params
      if (msg.method === "Page.frameAttached") {
        if (p.parentFrameId === host) this.appFrame = p.frameId
      } else if (msg.method === "Page.frameNavigated") {
        if (p.frame.parentId !== host) return
        this.appFrame = p.frame.id
        this.knobs = null
        this.onNavigated(p.frame.url)
      } else if (msg.method === "Page.navigatedWithinDocument") {
        if (p.frameId === this.appFrame) this.onNavigated(p.url)
      } else if (msg.method === "Page.loadEventFired") {
        this.onLoaded()
      } else if (
        msg.method === "Network.responseReceived" &&
        p.type === "Document" &&
        p.frameId === this.appFrame
      ) {
        this.onDocument(p.response.headers ?? {}, gen)
      } else if (msg.method === "Runtime.executionContextCreated") {
        const aux = p.context.auxData ?? {}
        if (aux.frameId === host && aux.isDefault)
          this.hostContext = p.context.id
      } else if (
        msg.method === "Runtime.bindingCalled" &&
        p.name === BINDING &&
        p.executionContextId === this.hostContext
      ) {
        this.fromPage(p.payload)
      }
    })
    await this.page("Runtime.addBinding", { name: BINDING })
    await this.page("Runtime.enable")
    await this.page("Page.enable")
    await this.page("Network.enable")
    await this.page("Emulation.setFocusEmulationEnabled", { enabled: true })
    await this.applySize()
    await this.restore()
    await this.page("Page.navigate", { url: hostUrl(this.path) })
    if (gen !== this.generation) return
    this.setStatus("live")
    this.restarts = 0
    if (this.viewers.size) this.startEncoder()
    else this.idleTimer ??= setTimeout(() => this.pause(), IDLE_PAUSE_MS)
  }

  page(method, params) {
    return this.cdp.send(method, params, this.session)
  }

  onBrowserExit(gen) {
    if (gen !== this.generation || this.closed) return
    // Hibernation and the Sandbox's 24-hour cap kill the whole service; a
    // browser that dies on its own comes back here, at the URL it was on.
    log(`frame ${this.id}: browser exited, restarting at ${this.path}`)
    this.teardown()
    this.setStatus("restarting")
    const delay = Math.min(RESTART_DELAY_MS * 2 ** this.restarts, 30_000)
    this.restarts++
    setTimeout(() => {
      if (this.closed || gen !== this.generation) return
      this.start().catch((e) => this.fail(e))
    }, delay)
  }

  fail(e) {
    log(`frame ${this.id}: ${e.message}`)
    // Not a crash to restart from: the next watch retries.
    this.generation++
    this.teardown()
    this.setStatus("failed")
  }

  /** Stop the browser and its display. An evicted frame keeps its profile
   *  to reopen on. */
  teardown({ keepProfile = false } = {}) {
    this.stopEncoder()
    this.still = []
    clearTimeout(this.idleTimer)
    this.idleTimer = null
    try {
      this.chrome?.kill("SIGKILL")
    } catch {}
    // TERM, so Xvfb removes its lock and the display can be used again.
    try {
      this.xvfb?.kill("SIGTERM")
    } catch {}
    if (this.display !== undefined) usedDisplays.delete(this.display)
    // The browser's helpers can still be writing the profile for a moment
    // after it dies, so removing it can fail; never let that stop a restart.
    if (this.userDataDir && !keepProfile) {
      rm(this.userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      }).catch((e) => log(`frame ${this.id}: ${e.message}`))
      this.userDataDir = undefined
      this.saved = null
    }
    this.chrome = this.xvfb = this.cdp = null
    this.display = undefined
    this.restoreScript = null
    this.frozen = false
  }

  close() {
    this.closed = true
    this.generation++
    this.teardown()
  }

  // ---- pause and eviction ----

  /** Running a browser, paused or not. */
  get running() {
    return (
      this.status === "starting" ||
      this.status === "live" ||
      this.status === "restarting"
    )
  }

  /** Watched by nobody, and no longer encoding. */
  get paused() {
    return this.status === "live" && !this.viewers.size && !this.enc
  }

  /** Stop capturing and encoding; the browser keeps running. The last
   *  pictures stay for the next viewer. */
  pause() {
    clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.viewers.size || this.status !== "live") return
    if (this.gop.length) this.still = this.gop
    this.stopEncoder()
    // Frozen, the page runs no scripts, and with its animations held it
    // stops painting, so a paused frame costs next to nothing (an animated
    // page drops from about 16% of a core to 3%). Its memory, and so its
    // state, stays.
    this.frozen = true
    this.page("Page.setWebLifecycleState", { state: "frozen" }).catch(() => {})
    this.page("Animation.setPlaybackRate", { playbackRate: 0 }).catch(() => {})
    log(`frame ${this.id}: paused`)
    enforceCap()
  }

  /** Let a paused page run again. */
  async thaw() {
    if (!this.frozen) return
    this.frozen = false
    await Promise.all([
      this.page("Page.setWebLifecycleState", { state: "active" }),
      this.page("Animation.setPlaybackRate", { playbackRate: 1 }),
    ])
  }

  /** Close a paused frame's browser to make room, keeping what reopening it
   *  at its URL needs: its cookies and storage, and its profile. */
  async evict() {
    if (this.evicting || !this.paused) return
    this.evicting = true
    try {
      const gen = this.generation
      const saved = await withTimeout(
        this.thaw().then(() => this.snapshot()),
        EVICT_TIMEOUT_MS
      ).catch(() => null)
      // Someone looked again meanwhile: it stays.
      if (gen !== this.generation || !this.paused) return
      this.generation++
      const chrome = this.chrome
      // A clean exit writes the profile (IndexedDB and the rest) to disk.
      if (chrome && chrome.exitCode === null) {
        const exited = new Promise((r) => chrome.once("exit", r))
        this.cdp?.send("Browser.close").catch(() => {})
        await withTimeout(exited, EVICT_TIMEOUT_MS).catch(() => {})
      }
      this.teardown({ keepProfile: true })
      this.saved = saved
      this.status = "evicted"
      log(`frame ${this.id}: closed its browser to stay under the cap`)
      // Someone looked again while it closed: it reopens.
      if (this.viewers.size) this.reopen()
    } finally {
      this.evicting = false
    }
  }

  /** Start a failed or closed frame again, at its URL. */
  reopen() {
    this.status = "starting"
    this.broadcastState()
    this.start().catch((e) => this.fail(e))
    enforceCap()
  }

  /** The page's cookies (session ones too, which a restarted browser would
   *  drop) and its local and session storage. */
  async snapshot() {
    const { cookies } = await this.cdp.send("Storage.getCookies")
    if (!this.appFrame) return { cookies, storage: null }
    // The app is the host page's iframe: read its storage from a world of
    // its own in that frame.
    const { executionContextId } = await this.page("Page.createIsolatedWorld", {
      frameId: this.appFrame,
      worldName: "screenplay-snapshot",
    })
    const origin = new URL(ORIGIN).origin
    const { result } = await this.page("Runtime.evaluate", {
      contextId: executionContextId,
      expression: `(() => {
        if (location.origin !== ${JSON.stringify(origin)}) return null
        const dump = (s) => {
          const o = {}
          for (let i = 0; i < s.length; i++) o[s.key(i)] = s.getItem(s.key(i))
          return o
        }
        return { local: dump(localStorage), session: dump(sessionStorage) }
      })()`,
      returnByValue: true,
    })
    return { cookies, storage: result?.value ?? null }
  }

  /** Put a reopened frame's cookies and storage back before its page loads. */
  async restore() {
    const saved = this.saved
    this.saved = null
    if (!saved) return
    if (saved.cookies?.length)
      await this.cdp
        .send("Storage.setCookies", { cookies: saved.cookies.map(cookieParam) })
        .catch((e) => log(`frame ${this.id}: cookies not restored:`, e.message))
    if (!saved.storage) return
    // Runs before the page's own scripts, on its first document; removed
    // once that has loaded, so later navigations keep the page's changes.
    const origin = new URL(ORIGIN).origin
    const { identifier } = await this.page(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `(() => {
          if (location.origin !== ${JSON.stringify(origin)}) return
          const saved = ${JSON.stringify(saved.storage)}
          try {
            for (const [k, v] of Object.entries(saved.local)) localStorage.setItem(k, v)
            for (const [k, v] of Object.entries(saved.session)) sessionStorage.setItem(k, v)
          } catch {}
        })()`,
      }
    )
    this.restoreScript = identifier
  }

  onLoaded() {
    const identifier = this.restoreScript
    if (!identifier) return
    this.restoreScript = null
    this.page("Page.removeScriptToEvaluateOnNewDocument", {
      identifier,
    }).catch(() => {})
  }

  /** The proxy answers with a placeholder while the dev server starts. A
   *  browser that opened then would sit on it, so it tries again. */
  onDocument(headers, gen) {
    const placeholder = Object.entries(headers).some(
      ([k, v]) =>
        k.toLowerCase() === "x-screenplay-proxy" && v === "placeholder"
    )
    if (!placeholder) return
    setTimeout(() => {
      if (gen !== this.generation || this.status !== "live") return
      this.go(this.path).catch(() => {})
    }, PLACEHOLDER_RETRY_MS)
  }

  /** Point the app's iframe at a route; a host page that's gone (it never
   *  should be) is opened again there. */
  async go(route) {
    const { result } = await this.page("Runtime.evaluate", {
      expression: `!!window.__screenplayHost && (__screenplayHost.go(${JSON.stringify(ORIGIN + route)}), true)`,
      returnByValue: true,
    })
    if (!result?.value)
      await this.page("Page.navigate", { url: hostUrl(route) })
  }

  // ---- size ----

  /** The encoded size: the frame at {@link SCALE}x, or less when that would
   *  pass the pixel budget or the display. Even, as yuv420 needs. */
  captureSize() {
    const max = this.maxPhysical
    let scale = Math.min(
      SCALE,
      Math.sqrt(MAX_PIXELS / (this.width * this.height)),
      max.width / this.width,
      max.height / this.height
    )
    scale = Math.floor(scale * 100) / 100
    const even = (n) => Math.max(2, Math.floor(n / 2) * 2)
    return {
      scale,
      width: even(this.width * scale),
      height: even(this.height * scale),
    }
  }

  async applySize() {
    this.capture = this.captureSize()
    await this.page("Emulation.setDeviceMetricsOverride", {
      width: this.width,
      height: this.height,
      deviceScaleFactor: 0,
      mobile: false,
      // The browser renders at SCALE; this brings a frame over budget down.
      scale: this.capture.scale / SCALE,
    })
  }

  async resize(width, height) {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    // A picture at the old size is no picture of the frame now.
    this.still = []
    if (this.status !== "live") return
    await this.applySize()
    this.broadcastState()
    if (this.enc) {
      this.stopEncoder()
      this.startEncoder()
    }
  }

  // ---- encoding ----

  startEncoder() {
    if (this.enc || this.status !== "live") return
    const { width, height } = this.capture
    // H.264 is what shipping browsers decode in hardware. VP8 is for test
    // browsers built without it (Playwright's Chromium).
    const codecArgs =
      CODEC === "h264"
        ? [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "baseline",
            "-x264-params",
            "aud=1:repeat-headers=1",
            "-bf",
            "0",
          ]
        : [
            "-c:v",
            "libvpx",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
            "-lag-in-frames",
            "0",
            "-error-resilient",
            "1",
          ]
    const enc = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "x11grab",
        "-draw_mouse",
        "0",
        "-framerate",
        String(FPS),
        "-video_size",
        `${width}x${height}`,
        "-i",
        `:${this.display}.0+0,0`,
        // Unchanged pictures are dropped before encoding, so a still page
        // sends nothing. Exact: any changed pixel goes through.
        "-vf",
        "mpdecimate=hi=0:lo=0:frac=0",
        ...codecArgs,
        "-pix_fmt",
        "yuv420p",
        "-g",
        String(FPS * 2),
        "-b:v",
        "6M",
        "-maxrate",
        "8M",
        "-bufsize",
        "2M",
        "-f",
        CODEC === "h264" ? "h264" : "ivf",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    )
    this.enc = enc
    this.gop = []
    enc.stderr.on("data", (d) =>
      log(`frame ${this.id} ffmpeg: ${String(d).trim()}`)
    )
    enc.on("exit", () => {
      if (this.enc !== enc) return
      this.enc = null
      // An encoder that dies while watched comes back on its own.
      if (this.viewers.size && this.status === "live")
        setTimeout(() => this.startEncoder(), RESTART_DELAY_MS)
    })
    if (CODEC === "h264") this.splitAnnexB(enc)
    else this.splitIvf(enc)
  }

  stopEncoder() {
    const enc = this.enc
    this.enc = null
    this.gop = []
    try {
      enc?.kill("SIGKILL")
    } catch {}
  }

  // H.264 Annex B: one access unit per AUD. A pause in the pipe means the
  // newest one is whole; without flushing it, each picture would wait for
  // the next, forever on a still page.
  splitAnnexB(enc) {
    let buf = Buffer.alloc(0)
    let flush = null
    enc.stdout.on("data", (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d
      let start = buf.indexOf(AUD)
      for (;;) {
        const next = start < 0 ? -1 : buf.indexOf(AUD, start + AUD.length)
        if (next < 0) break
        if (this.enc === enc)
          this.onAccessUnit(buf.subarray(start, next), hasIdr(buf, start, next))
        start = next
      }
      if (start > 0) buf = buf.subarray(start)
      clearTimeout(flush)
      flush = setTimeout(() => {
        if (
          this.enc === enc &&
          buf.length > AUD.length &&
          buf.indexOf(AUD) === 0
        ) {
          this.onAccessUnit(Buffer.from(buf), hasIdr(buf, 0, buf.length))
          buf = Buffer.alloc(0)
        }
      }, 2)
    })
  }

  // IVF: a 32-byte file header, then [u32 size][u64 pts][frame] per frame.
  splitIvf(enc) {
    let buf = Buffer.alloc(0)
    let header = false
    enc.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d])
      if (!header) {
        if (buf.length < 32) return
        buf = buf.subarray(32)
        header = true
      }
      while (buf.length >= 12) {
        const size = buf.readUInt32LE(0)
        if (buf.length < 12 + size) break
        const f = Buffer.from(buf.subarray(12, 12 + size))
        buf = buf.subarray(12 + size)
        if (this.enc === enc) this.onAccessUnit(f, (f[0] & 1) === 0)
      }
    })
  }

  onAccessUnit(au, key) {
    const head = Buffer.alloc(4)
    head[0] = 1
    head[1] = key ? 1 : 0
    head.writeUInt16BE(this.idBytes.length, 2)
    const message = Buffer.concat([head, this.idBytes, au])
    // Keep the current group of pictures, so a viewer who joins mid-stream
    // starts at its keyframe.
    if (key) {
      this.gop = []
      this.still = []
    }
    if (this.gop.length || key) this.gop.push(message)
    for (const v of this.viewers) v.sendVideo(this.id, message, key)
  }

  // ---- viewers ----

  addViewer(conn) {
    this.viewers.add(conn)
    conn.watching.add(this.id)
    this.lastViewed = Date.now()
    clearTimeout(this.idleTimer)
    this.idleTimer = null
    conn.sendJson(this.stateMessage())
    conn.sendJson({ t: "route", frame: this.id, path: this.path })
    // The current pictures, or a paused frame's last ones while its encoder
    // starts again.
    const pictures = this.gop.length ? this.gop : this.still
    for (const message of pictures)
      conn.sendVideo(this.id, message, message[1] === 1)
    this.thaw().catch(() => {})
    this.startEncoder()
    this.checkPrimary()
  }

  removeViewer(conn) {
    if (!this.viewers.delete(conn)) return
    conn.watching.delete(this.id)
    conn.needsKey.delete(this.id)
    if (this.driver?.conn === conn) this.driver = null
    for (const [id, req] of this.requests)
      if (req.conn === conn) this.requests.delete(id)
    this.checkPrimary()
    if (this.viewers.size) return
    // Nobody watching: pause after a grace period, keeping the browser.
    this.lastViewed = Date.now()
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.pause(), IDLE_PAUSE_MS)
  }

  stateMessage() {
    const capture = this.capture ?? { width: 0, height: 0, scale: SCALE }
    return {
      t: "frame",
      frame: this.id,
      status: this.status,
      width: this.width,
      height: this.height,
      videoWidth: capture.width,
      videoHeight: capture.height,
    }
  }

  setStatus(status) {
    this.status = status
    this.broadcastState()
  }

  broadcastState() {
    const msg = this.stateMessage()
    for (const v of this.viewers) v.sendJson(msg)
  }

  onNavigated(url) {
    let path
    try {
      const u = new URL(url)
      if (u.origin !== new URL(ORIGIN).origin) return
      path = u.pathname + u.search + u.hash
    } catch {
      return
    }
    this.navigatingTo = null
    if (path === this.path) return
    this.path = path
    for (const v of this.viewers)
      v.sendJson({ t: "route", frame: this.id, path })
  }

  // ---- bridge relay ----

  /** The viewer the page's room-writing reports go to, and the only one
   *  whose room changes reach the page: the driver, else whoever has
   *  watched longest. */
  primary() {
    const d = this.driver
    if (d && this.drives(d.conn) && this.viewers.has(d.conn)) return d.conn
    for (const v of this.viewers) return v
    return null
  }

  checkPrimary() {
    const next = this.primary()
    if (next === this.primaryConn) return
    this.primaryConn = next
    if (!next) return
    if (this.knobs)
      next.sendJson({ t: "bridge", frame: this.id, message: this.knobs })
    if (this.unanswered) {
      next.sendJson({ t: "bridge", frame: this.id, message: this.unanswered })
      this.unanswered = null
    }
  }

  /** A viewer's message for the page's bridge, as the canvas would post it
   *  into an iframe. */
  async toPage(conn, message) {
    if (this.status !== "live") return
    if (!message || typeof message !== "object") return
    if (BRIDGE_READS.has(message.type)) {
      if (typeof message.id !== "string" || message.id.length > 200) return
      const now = Date.now()
      for (const [id, req] of this.requests)
        if (now - req.at > REQUEST_TTL_MS) this.requests.delete(id)
      const id = `s${++this.requestSeq}`
      this.requests.set(id, { conn, id: message.id, at: now })
      message = { ...message, id }
    } else if (!BRIDGE_WRITES.has(message.type) || conn !== this.primary()) {
      return
    }
    // The message goes in as data: a string literal the host parses.
    const json = JSON.stringify(JSON.stringify(message))
    await this.page("Runtime.evaluate", {
      expression: `window.__screenplayHost && __screenplayHost.post(${json})`,
    })
  }

  /** A message the page posted to its parent, relayed by the host. */
  fromPage(payload) {
    if (typeof payload !== "string" || payload.length > MAX_PAGE_MESSAGE) return
    let message
    try {
      message = JSON.parse(payload)
    } catch {
      return
    }
    if (!message || typeof message.type !== "string") return
    const relay = (conn) =>
      conn.sendJson({ t: "bridge", frame: this.id, message })
    if (message.type === "screenplay:dom-result") {
      const req = this.requests.get(message.id)
      if (!req) return
      this.requests.delete(message.id)
      if (!this.viewers.has(req.conn)) return
      message = { ...message, id: req.id }
      relay(req.conn)
      return
    }
    if (message.type === "screenplay:hmr-status") {
      for (const v of this.viewers) relay(v)
      return
    }
    if (!PRIMARY_EVENTS.has(message.type)) return
    if (message.type === "screenplay:knobs-declared") this.knobs = message
    const primary = this.primary()
    if (primary) relay(primary)
    else if (message.type === "screenplay:shared-state-request")
      this.unanswered = message
  }

  // ---- input ----

  drives(conn) {
    return (
      this.driver !== null &&
      this.driver.conn === conn &&
      this.driver.exp > Date.now()
    )
  }

  async input(msg) {
    if (this.status !== "live") return
    const num = (n, d = 0) => (Number.isFinite(n) ? n : d)
    const mods = num(msg.modifiers)
    if (msg.kind === "mouse") {
      const type = ["mousePressed", "mouseReleased", "mouseMoved"].includes(
        msg.type
      )
        ? msg.type
        : null
      if (!type) return
      await this.page("Input.dispatchMouseEvent", {
        type,
        x: num(msg.x),
        y: num(msg.y),
        button: ["left", "middle", "right", "none"].includes(msg.button)
          ? msg.button
          : "none",
        buttons: num(msg.buttons),
        clickCount: num(msg.clickCount),
        modifiers: mods,
      })
    } else if (msg.kind === "wheel") {
      await this.page("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: num(msg.x),
        y: num(msg.y),
        deltaX: num(msg.deltaX),
        deltaY: num(msg.deltaY),
        modifiers: mods,
      })
    } else if (msg.kind === "key") {
      const type = ["keyDown", "keyUp", "rawKeyDown", "char"].includes(msg.type)
        ? msg.type
        : null
      if (!type) return
      const str = (s) => (typeof s === "string" ? s.slice(0, 32) : undefined)
      await this.page("Input.dispatchKeyEvent", {
        type,
        key: str(msg.key),
        code: str(msg.code),
        text: str(msg.text),
        unmodifiedText: str(msg.text),
        windowsVirtualKeyCode: num(msg.keyCode),
        nativeVirtualKeyCode: num(msg.keyCode),
        autoRepeat: !!msg.repeat,
        modifiers: mods,
      })
    } else if (msg.kind === "text") {
      if (typeof msg.text !== "string") return
      await this.page("Input.insertText", { text: msg.text.slice(0, 10_000) })
    }
  }
}

// ---------- host page ----------

/** The host page a frame's browser opens, with the app at `route`. */
function hostUrl(route) {
  return `http://127.0.0.1:${PORT}/frame-host?route=${encodeURIComponent(route)}`
}

/** JSON safe to put inside a <script>. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c")

/**
 * The app in a full-size iframe, sandboxed as the canvas sandboxes it, and
 * the relay between its bridge and this server. The app posts to its parent
 * as on the canvas; what it posts goes out through the binding, and the
 * server's messages come in through `__screenplayHost.post`. Only messages
 * from the app on the frame origin pass, and only to it.
 */
function hostPage(route) {
  const origin = new URL(ORIGIN).origin
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Screenplay frame</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:block}</style>
</head><body>
<iframe id="app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
<script>
(() => {
  const ORIGIN = ${scriptJson(origin)}
  const app = document.getElementById("app")
  const out = window[${scriptJson(BINDING)}]
  window.addEventListener("message", (e) => {
    if (e.source !== app.contentWindow || e.origin !== ORIGIN) return
    const d = e.data
    if (!d || typeof d.type !== "string" || !d.type.startsWith("screenplay:")) return
    try { out(JSON.stringify(d)) } catch {}
  })
  window.__screenplayHost = {
    post(json) {
      if (app.contentWindow) app.contentWindow.postMessage(JSON.parse(json), ORIGIN)
    },
    go(url) { app.src = url },
  }
  // Keys go to the app, as they would to a page opened on its own.
  app.addEventListener("load", () => app.focus())
  app.src = ${scriptJson(ORIGIN + route)}
})()
</script>
</body></html>`
}

/** Past the cap, close the least recently viewed paused browsers. Frames
 *  someone watches are never closed, so the cap can be passed while they are
 *  all watched. */
function enforceCap() {
  const running = [...frames.values()].filter((f) => f.running && !f.evicting)
  let over = running.length - MAX_BROWSERS
  if (over <= 0) return
  const paused = running
    .filter((f) => f.paused)
    .sort((a, b) => a.lastViewed - b.lastViewed)
  for (const frame of paused) {
    if (over-- <= 0) break
    frame.evict().catch((e) => log(`frame ${frame.id}: ${e.message}`))
  }
}

/** A cookie from `Storage.getCookies` as `Storage.setCookies` takes it. */
function cookieParam(c) {
  const param = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
  }
  if (c.sameSite) param.sameSite = c.sameSite
  if (c.priority) param.priority = c.priority
  if (c.sourceScheme) param.sourceScheme = c.sourceScheme
  if (typeof c.sourcePort === "number") param.sourcePort = c.sourcePort
  if (c.partitionKey) param.partitionKey = c.partitionKey
  if (!c.session && typeof c.expires === "number" && c.expires > 0)
    param.expires = c.expires
  return param
}

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

function hasIdr(buf, start, end) {
  for (let i = start; i + 4 < end; i++) {
    if (
      buf[i] === 0 &&
      buf[i + 1] === 0 &&
      buf[i + 2] === 1 &&
      (buf[i + 3] & 0x1f) === 5
    )
      return true
  }
  return false
}

// ---------- messages ----------

async function handleMessage(conn, msg) {
  const id =
    typeof msg.frame === "string" && msg.frame.length <= 200 ? msg.frame : null
  if (!id) return
  let frame = frames.get(id)
  switch (msg.t) {
    case "watch": {
      if (
        !validRoute(msg.route) ||
        !validSize(msg.width) ||
        !validSize(msg.height)
      )
        return
      if (!frame) {
        frame = new Frame(
          id,
          msg.route,
          Math.round(msg.width),
          Math.round(msg.height)
        )
        frames.set(id, frame)
        frame.start().catch((e) => frame.fail(e))
        enforceCap()
      }
      // A frame that failed to start is retried when someone looks again,
      // and a closed one reopens at its URL.
      if (frame.status === "failed" || frame.status === "evicted")
        frame.reopen()
      frame.addViewer(conn)
      return
    }
    case "unwatch":
      frame?.removeViewer(conn)
      return
  }
  if (!frame || !conn.watching.has(id)) return
  switch (msg.t) {
    case "size":
      if (validSize(msg.width) && validSize(msg.height))
        await frame.resize(Math.round(msg.width), Math.round(msg.height))
      return
    case "navigate":
      // The room's route. Every viewer sends it; only a change navigates.
      if (
        validRoute(msg.route) &&
        msg.route !== frame.path &&
        msg.route !== frame.navigatingTo &&
        frame.status === "live"
      ) {
        frame.navigatingTo = msg.route
        await frame.go(msg.route)
      }
      return
    case "reload":
      if (frame.status === "live") await frame.go(frame.path)
      return
    case "drive": {
      const claims = verifyToken(msg.token)
      if (
        !claims ||
        claims.k !== "drive" ||
        claims.frame !== id ||
        claims.sub !== conn.user
      ) {
        conn.sendJson({ t: "error", frame: id, message: "drive refused" })
        return
      }
      // The newest grant wins: the app signs one only for the driver.
      frame.driver = { conn, exp: claims.exp }
      frame.checkPrimary()
      return
    }
    case "release":
      if (frame.driver?.conn === conn) frame.driver = null
      frame.checkPrimary()
      return
    case "bridge":
      await frame.toPage(conn, msg.message)
      return
    case "input":
      // Watchers' input never reaches the page.
      if (frame.drives(conn)) await frame.input(msg)
      return
  }
}

// ---------- server ----------

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" })
    return res.end("ok")
  }
  const url = new URL(req.url ?? "/", "http://localhost")
  // The host page is for the frames' own browsers, on loopback; the
  // Sandbox's public port never serves it.
  if (
    url.pathname === "/frame-host" &&
    /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host))
  ) {
    const route = url.searchParams.get("route")
    if (!validRoute(route)) return res.writeHead(400).end()
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    })
    return res.end(hostPage(route))
  }
  res.writeHead(404).end()
})

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"]
  if (String(req.headers.upgrade).toLowerCase() !== "websocket" || !key) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
    return
  }
  const accept = createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64")
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  )
  new Connection(socket)
})

const shutdown = () => {
  for (const frame of frames.values()) frame.close()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

server.listen(PORT, HOST, () =>
  log(`listening on ${HOST}:${PORT}, frames load ${ORIGIN}`)
)
