#!/usr/bin/env node
// PROTOTYPE for #983 ("Does a streamed frame feel good enough to work in?").
// Throwaway: not wired into the app, not for main. Zero dependencies.
//
// Runs one frame as a headless Chrome tab, streams it with CDP
// Page.startScreencast to every viewer over a WebSocket, and forwards the
// current driver's input back with Input.dispatch*Event (research #980).
//
//   node apps/app/lib/live-frame/stream.prototype.mjs [--url http://app.localhost:3000]
//   open http://localhost:4983 (open it twice, or on another machine, to be two viewers)
//
// Results: stream.prototype.results.md. Bench: stream.prototype.bench.mjs.
//
// Flags: --url <page to stream> (default: built-in demo page)
//        --port 4983  --width 1280 --height 800  --quality 80
//        --delay <ms> artificial one-way network delay, to feel a remote viewer
//        --max-dsf 2  sharpest pixel ratio the stream can follow canvas zoom to (1 = never)
//        --chrome <path> (or CHROME env); defaults to Chrome for Testing /
//          Google Chrome on macOS, Playwright's Chromium on Linux.
import { spawn, execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync, existsSync, mkdtempSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir, platform } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const PORT = Number(arg("port", 4983))
const WIDTH = Number(arg("width", 1280))
const HEIGHT = Number(arg("height", 800))
const QUALITY = Number(arg("quality", 80))
const DELAY = Number(arg("delay", 0))
const MAX_DSF = Number(arg("max-dsf", 2))
const URL_TO_STREAM = arg("url", `http://127.0.0.1:${PORT}/demo`)

function findChrome() {
  const explicit = arg("chrome", process.env.CHROME)
  if (explicit) return explicit
  const candidates =
    platform() === "darwin"
      ? [
          "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome"]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error("No Chrome found. Pass --chrome <path> or set CHROME.")
  return found
}

// ---------- Chrome + CDP ----------

async function launchChrome() {
  // Own profile: Chrome 136+ refuses remote debugging on the default profile.
  const profile = mkdtempSync(join(tmpdir(), "screenplay-stream-PROTOTYPE-"))
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      // Headless paints at the window's scale (1x) whatever the emulated pixel ratio, so
      // the screencast only gets sharper up to this. Emulation then picks 1..MAX_DSF.
      // Costly: Chrome rasterizes at MAX_DSF even while streaming at 1x.
      ...(MAX_DSF > 1 ? [`--force-device-scale-factor=${MAX_DSF}`] : []),
      "--mute-audio",
      // Keep painting while nobody "looks" at the headless window.
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      // Containers run as root, where Chrome's sandbox can't start.
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  )
  process.on("exit", () => chrome.kill())
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0))
  const browserWs = await new Promise((resolve, reject) => {
    let buf = ""
    chrome.stderr.on("data", (d) => {
      buf += d
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) resolve(m[1])
    })
    chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code}): ${buf}`)))
  })
  const httpBase = browserWs.replace(/^ws/, "http").replace(/\/devtools.*$/, "")
  const targets = await (await fetch(`${httpBase}/json/list`)).json()
  const page = targets.find((t) => t.type === "page")
  return { pid: chrome.pid, pageWs: page.webSocketDebuggerUrl, browserWs, targetId: page.id }
}

function cdpConnect(url) {
  const ws = new WebSocket(url)
  let nextId = 1
  const pending = new Map()
  const listeners = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    } else listeners.get(msg.method)?.(msg.params)
  }
  return new Promise((resolve) => {
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++
          ws.send(JSON.stringify({ id, method, params }))
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }))
        },
        on(method, fn) {
          listeners.set(method, fn)
        },
      })
  })
}

// ---------- Minimal WebSocket server (RFC 6455, enough for a prototype) ----------

function acceptWebSocket(req, socket, onMessage, onClose) {
  const accept = createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64")
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  socket.setNoDelay(true)
  let buf = Buffer.alloc(0)
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 2) return
      const opcode = buf[0] & 0x0f
      let len = buf[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        off = 10
      }
      const masked = buf[1] & 0x80
      const maskOff = off
      if (masked) off += 4
      if (buf.length < off + len) return
      const payload = Buffer.from(buf.subarray(off, off + len))
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[maskOff + (i % 4)]
      buf = buf.subarray(off + len)
      if (opcode === 8) return socket.end()
      if (opcode === 9) socket.write(frame(payload, 0xa))
      if (opcode === 1) onMessage(payload.toString())
    }
  })
  socket.on("close", onClose)
  socket.on("error", () => {})
  return {
    send: (data) => socket.writable && socket.write(frame(data, typeof data === "string" ? 1 : 2)),
    get buffered() {
      return socket.writableLength
    },
  }
}

function frame(data, opcode) {
  const payload = typeof data === "string" ? Buffer.from(data) : data
  const len = payload.length
  const head =
    len < 126
      ? Buffer.from([0x80 | opcode, len])
      : len < 65536
        ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), bigLen(len)])
  return Buffer.concat([head, payload])
}
function bigLen(n) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(n))
  return b
}

// ---------- Process stats (Chrome's whole process tree) ----------

function processTree(rootPid) {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,time="]).toString().trim().split("\n")
  const procs = rows.map((r) => {
    const [pid, ppid, rss, time] = r.trim().split(/\s+/)
    return { pid: +pid, ppid: +ppid, rssKb: +rss, cpuSec: parseCpuTime(time) }
  })
  const ids = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const p of procs) if (!ids.has(p.pid) && ids.has(p.ppid)) (ids.add(p.pid), (grew = true))
  }
  const tree = procs.filter((p) => ids.has(p.pid))
  return {
    processes: tree.length,
    rssMb: tree.reduce((s, p) => s + p.rssKb, 0) / 1024,
    cpuSec: tree.reduce((s, p) => s + (platform() === "linux" ? procCpu(p.pid) : p.cpuSec), 0),
    // PSS avoids double-counting shared pages across Chrome's processes (Linux only).
    pssMb: platform() === "linux" ? tree.reduce((s, p) => s + pss(p.pid), 0) / 1024 : null,
  }
}
function parseCpuTime(t) {
  // [[dd-]hh:]mm:ss[.cc]
  let days = 0
  if (t.includes("-")) [days, t] = [+t.split("-")[0], t.split("-")[1]]
  const parts = t.split(":").map(Number)
  while (parts.length < 3) parts.unshift(0)
  return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]
}
// ps reports whole seconds; /proc has clock ticks (100/s).
function procCpu(pid) {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")
    return (Number(f[11]) + Number(f[12])) / 100
  } catch {
    return 0
  }
}
function pss(pid) {
  try {
    const m = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)
    return m ? +m[1] : 0
  } catch {
    return 0
  }
}

// ---------- Relay ----------

const { pid: chromePid, pageWs, browserWs, targetId } = await launchChrome()
const cdp = await cdpConnect(pageWs)

// Resize the headless window so its viewport is exactly WIDTH x HEIGHT. An emulated
// viewport bigger than the window makes the screencast stall after two frames, and a
// smaller one leaves the rest of the window in the picture. Headless still reserves
// part of the window for (invisible) browser chrome, so measure and correct.
{
  const browser = await cdpConnect(browserWs)
  const { windowId } = await browser.send("Browser.getWindowForTarget", { targetId })
  const inner = async () =>
    (await cdp.send("Runtime.evaluate", { expression: "[innerWidth, innerHeight]", returnByValue: true })).result.value
  for (let i = 0; i < 5; i++) {
    const { bounds } = await browser.send("Browser.getWindowBounds", { windowId })
    const [w, h] = await inner()
    if (w === WIDTH && h === HEIGHT) break
    await browser.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: bounds.width + WIDTH - w, height: bounds.height + HEIGHT - h },
    })
    await new Promise((r) => setTimeout(r, 100))
  }
}

const viewers = new Map() // id -> { name, conn, zoom, bytes, frames }
let driver = null
let dsf = 1
let followZoom = true
let frameSeq = 0
let lastInputSeq = 0
let cursor = "default"
const counters = { frames: 0, bytes: 0 }

const later = (fn) => (DELAY ? setTimeout(fn, DELAY) : fn())

function broadcastState() {
  const state = JSON.stringify({
    type: "state",
    driver,
    dsf,
    followZoom,
    cursor,
    url: URL_TO_STREAM,
    width: WIDTH,
    height: HEIGHT,
    delay: DELAY,
    viewers: [...viewers].map(([id, v]) => ({ id, name: v.name, zoom: v.zoom })),
  })
  for (const v of viewers.values()) later(() => v.conn.send(state))
}

async function startScreencast() {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: dsf,
    mobile: false,
  })
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: QUALITY,
    // Width decides the scale. Headless captures a strip below the viewport too, so
    // leave height unconstrained and let viewers crop to WIDTH x HEIGHT.
    maxWidth: Math.round(WIDTH * dsf),
    maxHeight: Math.round(HEIGHT * dsf * 2),
  })
}

// Stream at the sharpest scale any viewer needs: canvas zoom x screen DPR.
let dsfTimer
function retargetDsf() {
  clearTimeout(dsfTimer)
  dsfTimer = setTimeout(async () => {
    const wanted = followZoom
      ? Math.min(MAX_DSF, Math.max(1, ...[...viewers.values()].map((v) => v.zoom || 1)))
      : 1
    const next = Math.round(wanted * 4) / 4
    if (next === dsf) return
    dsf = next
    await cdp.send("Page.stopScreencast")
    await startScreencast()
    broadcastState()
  }, 150)
}

cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
  // Ack at once so Chrome keeps painting; slow viewers only fall behind here.
  cdp.send("Page.screencastFrameAck", { sessionId })
  const jpeg = Buffer.from(data, "base64")
  const header = Buffer.from(
    JSON.stringify({
      seq: ++frameSeq,
      dsf,
      inputSeq: lastInputSeq,
      w: metadata.deviceWidth,
      h: metadata.deviceHeight,
    }),
  )
  const len = Buffer.alloc(4)
  len.writeUInt32BE(header.length)
  const msg = Buffer.concat([len, header, jpeg])
  counters.frames++
  counters.bytes += msg.length
  for (const v of viewers.values()) {
    // Drop frames for a viewer whose socket is backed up rather than queueing lag.
    if (v.conn.buffered > 2 * msg.length) {
      v.dropped++
      continue
    }
    v.frames++
    v.bytes += msg.length
    later(() => v.conn.send(msg))
  }
})

let cursorPending = false
async function updateCursor(x, y) {
  // Headless Chrome doesn't report the cursor, so ask the page what's under the pointer.
  if (cursorPending) return
  cursorPending = true
  try {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? getComputedStyle(el).cursor : "default" })()`,
      returnByValue: true,
    })
    const next = result.value === "auto" ? "default" : result.value
    if (next !== cursor) {
      cursor = next
      const msg = JSON.stringify({ type: "cursor", cursor })
      for (const v of viewers.values()) later(() => v.conn.send(msg))
    }
  } finally {
    setTimeout(() => (cursorPending = false), 40)
  }
}

async function handleInput(id, msg) {
  if (id !== driver) return // Only the driver's input reaches the page.
  lastInputSeq = msg.seq ?? lastInputSeq
  const { kind, params } = msg
  if (kind === "mouse") {
    await cdp.send("Input.dispatchMouseEvent", params)
    if (params.type === "mouseMoved") updateCursor(params.x, params.y)
  } else if (kind === "key") await cdp.send("Input.dispatchKeyEvent", params)
  else if (kind === "text") await cdp.send("Input.insertText", params)
}

function onViewerMessage(id, raw) {
  const msg = JSON.parse(raw)
  const v = viewers.get(id)
  if (msg.type === "hello") {
    v.name = msg.name
    if (!driver) driver = id
    broadcastState()
  } else if (msg.type === "zoom") {
    v.zoom = msg.scale
    retargetDsf()
  } else if (msg.type === "follow-zoom") {
    followZoom = msg.on
    retargetDsf()
    broadcastState()
  } else if (msg.type === "take-control") {
    driver = id
    broadcastState()
  } else if (msg.type === "input") handleInput(id, msg)
  else if (msg.type === "navigate") cdp.send("Page.navigate", { url: msg.url })
  else if (msg.type === "reload") cdp.send("Page.reload")
  else if (msg.type === "ping") later(() => v.conn.send(JSON.stringify({ type: "pong", t: msg.t })))
}

// Each caller (?who=) gets its own measuring window, so viewers' HUDs don't reset the bench's.
const statWindows = new Map()
function stats(who) {
  const now = Date.now()
  const tree = processTree(chromePid)
  const relayCpu = process.cpuUsage()
  const last = statWindows.get(who) ?? { at: now - 1, cpuSec: tree.cpuSec, relayCpu, frames: counters.frames, bytes: counters.bytes }
  const secs = (now - last.at) / 1000
  statWindows.set(who, { at: now, cpuSec: tree.cpuSec, relayCpu, frames: counters.frames, bytes: counters.bytes })
  return {
    chrome: {
      processes: tree.processes,
      rssMb: Math.round(tree.rssMb),
      pssMb: tree.pssMb && Math.round(tree.pssMb),
      cpuPercent: Math.round(((tree.cpuSec - last.cpuSec) / secs) * 100),
    },
    relay: {
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      cpuPercent: Math.round(((relayCpu.user + relayCpu.system - last.relayCpu.user - last.relayCpu.system) / 1e6 / secs) * 100),
    },
    stream: {
      dsf,
      fps: +((counters.frames - last.frames) / secs).toFixed(1),
      kbps: Math.round(((counters.bytes - last.bytes) * 8) / 1000 / secs),
    },
    viewers: [...viewers.values()].map((v) => ({ name: v.name, frames: v.frames, dropped: v.dropped })),
  }
}

const files = {
  "/": ["stream.prototype.viewer.html", "text/html"],
  "/demo": ["stream.prototype.demo.html", "text/html"],
}
const server = createServer((req, res) => {
  const path = req.url.split("?")[0]
  if (path === "/debug") {
    const expression = new URL(req.url, "http://x").searchParams.get("expr") ?? "JSON.stringify([innerWidth, innerHeight, devicePixelRatio])"
    return cdp
      .send("Runtime.evaluate", { expression, returnByValue: true })
      .then((r) => res.end(r.result.value))
  }
  if (path === "/stats") {
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify(stats(new URL(req.url, "http://x").searchParams.get("who") ?? "")))
  }
  const file = files[path]
  if (!file) return res.writeHead(404).end()
  res.writeHead(200, { "content-type": file[1], "cache-control": "no-store" })
  res.end(readFileSync(join(here, file[0])))
})
server.on("upgrade", (req, socket) => {
  const id = randomUUID().slice(0, 8)
  const conn = acceptWebSocket(
    req,
    socket,
    (raw) => later(() => onViewerMessage(id, raw)),
    () => {
      viewers.delete(id)
      if (driver === id) driver = viewers.keys().next().value ?? null
      retargetDsf()
      broadcastState()
    },
  )
  viewers.set(id, { name: id, conn, zoom: 1, frames: 0, bytes: 0, dropped: 0 })
  conn.send(JSON.stringify({ type: "welcome", id }))
})

await new Promise((r) => server.listen(PORT, r))
await cdp.send("Page.enable")
await cdp.send("Page.bringToFront")
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true })
await cdp.send("Page.navigate", { url: URL_TO_STREAM })
await startScreencast()
if (arg("dsf")) {
  followZoom = false
  dsf = Number(arg("dsf"))
  await cdp.send("Page.stopScreencast")
  await startScreencast()
}
console.log(`PROTOTYPE streaming ${URL_TO_STREAM}`)
console.log(`Open http://localhost:${PORT} (open it twice to be two viewers)${DELAY ? `, ${DELAY} ms one-way delay` : ""}`)
