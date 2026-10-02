#!/usr/bin/env node
// PROTOTYPE (shared live frame, video streaming), not for main. Throwaway; see README.md.
//
// One shared live instance per frame that everyone, the agent included, can drive. Each frame is a
// real (headful) Chromium on its own virtual X display. ffmpeg grabs the display, encodes H.264 once
// and the server fans it out to every viewer over one of two transports:
//   - webrtc: RTP over UDP through werift (needs UDP or a TURN relay; Vercel Sandbox exposes only HTTPS)
//   - ws:     the same H.264 over a WebSocket, decoded with WebCodecs (works through an HTTPS port)
// Input from the current driver (#981 handoff: one driver, others request, the driver grants) goes
// into the page through CDP. The agent drives through the same gate over HTTP (/agent/...).
//
//   node server.mjs [--frames 1] [--port 4990] [--fps 30] [--page spinner|busy] [--delay 0] [--size 1280x800]
import { spawn, execFileSync } from "node:child_process"
import { createSocket } from "node:dgram"
import { readFileSync, readdirSync, mkdtempSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"
import { RTCPeerConnection, RTCRtpCodecParameters, MediaStreamTrack } from "werift"

const here = dirname(fileURLToPath(import.meta.url))
const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const FRAMES = Number(arg("frames", 1))
const PORT = Number(arg("port", 4990))
const FPS = Number(arg("fps", 30))
const PAGE = arg("page", "")
const DELAY = Number(arg("delay", 0)) // ms added each way on the ws transport, standing in for a remote viewer
const [W, H] = arg("size", "1280x800").split("x").map(Number)
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium"
const CPUS = arg("cpus", "")
// h264 is what shipping browsers (Chrome, Safari, the Mac webview) decode in hardware. The Playwright
// Chromium in this container has no H.264, so the bench here runs vp8.
const CODEC = arg("codec", "h264")
const PAUSE = arg("pause", "off") // "viewers": stop encoding while nobody watches
const PAUSE_AFTER = Number(arg("pause-after", 0))
const DECIMATE = process.argv.includes("--decimate") // e.g. "0,1": pin the streamed stack, as a 2-vCPU Sandbox stand-in
const pin = (cmd, args) => (CPUS ? ["taskset", ["-c", CPUS, cmd, ...args]] : [cmd, args])
const kids = []
const run = (cmd, args, opts = {}) => { const [c, a] = pin(cmd, args); const p = spawn(c, a, { stdio: ["ignore", "pipe", "pipe"], ...opts }); kids.push(p); return p }
const cleanup = () => { for (const k of kids) try { k.kill("SIGKILL") } catch {} }
process.on("exit", cleanup)
process.on("SIGINT", () => process.exit(0))
process.on("SIGTERM", () => process.exit(0))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- one frame: X display + Chromium + encoder ----------
async function startFrame(i) {
  const display = `:${90 + i}`
  const xvfb = run("Xvfb", [display, "-screen", "0", `${W}x${H}x24`, "-nolisten", "tcp"])
  await sleep(400)
  const cdpPort = 9300 + i
  const chrome = run(CHROME, [
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "live-frame-"))}`,
    "--no-first-run", "--no-default-browser-check", "--disable-infobars", "--kiosk", "--window-position=0,0",
    `--window-size=${W},${H}`, "--force-device-scale-factor=1", "--disable-gpu", "--no-sandbox",
    "--password-store=basic", `http://127.0.0.1:${PORT}/demo${PAGE ? "?" + PAGE : ""}`,
  ], { env: { ...process.env, DISPLAY: display } })
  let page
  for (let t = 0; t < 50 && !page; t++) {
    await sleep(200)
    try { page = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((x) => x.type === "page") } catch {}
  }
  if (!page) throw new Error(`frame ${i}: Chromium didn't come up`)
  const cdp = await connectCdp(page.webSocketDebuggerUrl)

  const rtpPort = 5100 + 2 * i
  const frame = { i, display, xvfb, chrome, enc: null, cdp, rtpPort, ws: new Set(), rtc: new Set(), gop: [], driver: null, requests: [], bytesOut: 0, rtpBytes: 0, aus: 0, idleTimer: null }
  if (PAUSE === "off") startEncoder(frame)

  // webrtc transport: ffmpeg's RTP packets go straight into every peer's track.
  const udp = createSocket("udp4")
  udp.on("message", (pkt) => { frame.rtpBytes += pkt.length; for (const t of frame.rtc) t.writeRtp(pkt) })
  udp.bind(rtpPort, "127.0.0.1")
  return frame
}

// One encode per frame. tee writes the same video to stdout (ws transport) and to RTP (webrtc).
function startEncoder(frame) {
  if (frame.enc) return
  const t0 = Date.now()
  const enc = run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(FPS),
    "-video_size", `${W}x${H}`, "-i", `${frame.display}.0`,
    // --decimate: drop frames identical to the last one before encoding, so a still page costs only the grab
    ...(DECIMATE ? ["-vf", "mpdecimate=max=0", "-fps_mode", "vfr"] : []),
    ...(CODEC === "h264"
      ? ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline",
         "-x264-params", "aud=1:repeat-headers=1", "-bf", "0"]
      : ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-lag-in-frames", "0", "-error-resilient", "1",
         "-threads", "2", "-static-thresh", "0", "-max-intra-rate", "300"]),
    "-pix_fmt", "yuv420p", "-g", String(FPS * 2), "-b:v", "3M", "-maxrate", "4M", "-bufsize", "1M",
    "-f", "tee", "-map", "0:v",
    `[f=${CODEC === "h264" ? "h264" : "ivf"}]pipe\\:1|[f=rtp:payload_type=96]rtp\\://127.0.0.1\\:${frame.rtpPort}?pkt_size=1200`,
  ])
  frame.enc = enc
  frame.gop = []
  enc.stderr.on("data", (d) => process.stderr.write(`[ffmpeg ${frame.i}] ${d}`))
  let first = true
  const au = (data, key) => {
    if (first) { first = false; console.log(`frame ${frame.i}: encoder up, first picture ${Date.now() - t0} ms after start`) }
    onAccessUnit(frame, data, key)
  }
  // ws transport: split the Annex B stream into access units on the AUD (00 00 00 01 09), keep the
  // current GOP so a viewer joining mid-stream can start at the last keyframe.
  let buf = Buffer.alloc(0)
  let flushTimer = null
  if (CODEC === "vp8") {
    // IVF: 32-byte file header, then [4-byte size][8-byte pts][frame] per frame.
    let headerDone = false
    enc.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d])
      if (!headerDone) { if (buf.length < 32) return; buf = buf.subarray(32); headerDone = true }
      while (buf.length >= 12) {
        const size = buf.readUInt32LE(0)
        if (buf.length < 12 + size) break
        const f = buf.subarray(12, 12 + size)
        buf = buf.subarray(12 + size)
        au(Buffer.from(f), (f[0] & 1) === 0)
      }
    })
  } else enc.stdout.on("data", (d) => {
    buf = Buffer.concat([buf, d])
    let start = buf.indexOf(AUD)
    for (;;) {
      const next = buf.indexOf(AUD, start + 4)
      if (start < 0 || next < 0) break
      au(buf.subarray(start, next))
      start = next
    }
    if (start > 0) buf = buf.subarray(start)
    // ffmpeg writes one access unit per packet, so a pause in the pipe means the last one is whole.
    // Without this the newest picture waits for the next one (a frame of lag, forever with --decimate).
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => { if (buf.length > AUD.length && buf.indexOf(AUD) === 0) { au(Buffer.from(buf)); buf = Buffer.alloc(0) } }, 2)
  })

}
function stopEncoder(frame) {
  if (!frame.enc) return
  frame.enc.kill("SIGKILL")
  frame.enc = null
  frame.gop = []
  console.log(`frame ${frame.i}: paused (no viewers)`)
}
// --pause viewers: a frame with nobody watching stops its encoder (the browser keeps running, so no
// state is lost) and starts it again when someone looks. --pause-after ms waits before pausing.
function viewersChanged(frame) {
  if (PAUSE === "off") return
  const n = frame.ws.size + (frame.wsControl?.size ?? 0)
  clearTimeout(frame.idleTimer)
  if (n > 0) startEncoder(frame)
  else frame.idleTimer = setTimeout(() => stopEncoder(frame), PAUSE_AFTER)
}
const AUD = Buffer.from([0, 0, 0, 1, 9])

function onAccessUnit(frame, au, key = hasIdr(au)) {
  const msg = Buffer.concat([Buffer.from([key ? 1 : 0]), au])
  if (key) frame.gop = []
  frame.gop.push(msg)
  frame.aus++
  for (const v of frame.ws) send(v, msg)
}
function hasIdr(au) {
  for (let i = 0; i + 4 < au.length; i++) if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1 && (au[i + 3] & 0x1f) === 5) return true
  return false
}
const later = (fn) => (DELAY ? setTimeout(fn, DELAY) : fn())
function send(v, data) {
  later(() => { if (v.sock.readyState === 1) { v.sock.send(data); if (typeof data !== "string") v.frame.bytesOut += data.length } })
}

// ---------- CDP ----------
async function connectCdp(url) {
  const ws = new WebSocket(url)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id) } }
  return (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
}
async function dispatch(frame, input) {
  if (input.kind === "mouse") return frame.cdp("Input.dispatchMouseEvent", input.e)
  if (input.kind === "key") return frame.cdp("Input.dispatchKeyEvent", input.e)
  if (input.kind === "text") return frame.cdp("Input.insertText", { text: input.text })
}

// ---------- #981 handoff: one driver, others request, the driver grants ----------
function stateOf(frame) {
  return { type: "state", driver: frame.driver, requests: frame.requests, viewers: [...frame.ws, ...(frame.wsControl ?? [])].map((v) => v.who) }
}
function broadcastState(frame) {
  const s = JSON.stringify(stateOf(frame))
  for (const v of [...frame.ws, ...(frame.wsControl ?? [])]) send(v, s)
}
function control(frame, who, msg) {
  if (msg.type === "request") {
    if (!frame.driver) frame.driver = who
    else if (frame.driver !== who && !frame.requests.includes(who)) frame.requests.push(who)
  } else if (msg.type === "grant" && frame.driver === who && frame.requests.includes(msg.to)) {
    frame.driver = msg.to
    frame.requests = frame.requests.filter((r) => r !== msg.to)
  } else if (msg.type === "release" && frame.driver === who) {
    frame.driver = frame.requests.shift() ?? null
  } else return false
  broadcastState(frame)
  return true
}

// ---------- process stats (CPU %, PSS) ----------
const CLK = 100
function tree(pid) {
  const all = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map((d) => {
    try { const s = readFileSync(`/proc/${d}/stat`, "utf8"); const f = s.slice(s.lastIndexOf(")") + 2).split(" "); return { pid: +d, ppid: +f[1], cpu: +f[11] + +f[12] } } catch { return null }
  }).filter(Boolean)
  const out = []
  const walk = (p) => { for (const x of all) if (x.ppid === p) { out.push(x); walk(x.pid) } }
  const self = all.find((x) => x.pid === pid)
  if (self) out.push(self)
  walk(pid)
  return out
}
const pss = (pids) => pids.reduce((s, p) => { try { return s + +readFileSync(`/proc/${p}/smaps_rollup`, "utf8").match(/Pss:\s+(\d+)/)[1] } catch { return s } }, 0)
let last = null
function sample() {
  const now = Date.now()
  const procs = { server: [process.pid] }
  for (const f of frames) { procs[`xvfb${f.i}`] = [f.xvfb.pid]; procs[`chrome${f.i}`] = [f.chrome.pid]; if (f.enc) procs[`ffmpeg${f.i}`] = [f.enc.pid] }
  const cur = { t: now, cpu: {}, pss: {}, bytes: frames.map((f) => [f.bytesOut, f.rtpBytes, f.aus]) }
  for (const [k, [pid]] of Object.entries(procs)) {
    const t = k === "server" ? [{ pid, cpu: (() => { const s = readFileSync(`/proc/${pid}/stat`, "utf8"); const f = s.slice(s.lastIndexOf(")") + 2).split(" "); return +f[11] + +f[12] })() }] : tree(pid)
    cur.cpu[k] = t.reduce((s, x) => s + x.cpu, 0)
    cur.pss[k] = Math.round(pss(t.map((x) => x.pid)) / 1024)
  }
  const prev = last
  last = cur
  if (!prev) return null
  const dt = (cur.t - prev.t) / 1000
  const cpu = {}
  for (const k in cur.cpu) cpu[k] = Math.round(((cur.cpu[k] - (prev.cpu[k] ?? 0)) / CLK / dt) * 100)
  const sum = (re) => Object.entries(cpu).filter(([k]) => re.test(k)).reduce((s, [, v]) => s + v, 0)
  const sumPss = (re) => Object.entries(cur.pss).filter(([k]) => re.test(k)).reduce((s, [, v]) => s + v, 0)
  return {
    seconds: +dt.toFixed(1),
    cpuPct: { chrome: sum(/^chrome/), ffmpeg: sum(/^ffmpeg/), xvfb: sum(/^xvfb/), server: cpu.server, total: sum(/./) },
    pssMB: { chrome: sumPss(/^chrome/), ffmpeg: sumPss(/^ffmpeg/), xvfb: sumPss(/^xvfb/), server: cur.pss.server, total: sumPss(/./) },
    perFrame: frames.map((f, k) => ({
      frame: f.i,
      fps: +((cur.bytes[k][2] - prev.bytes[k][2]) / dt).toFixed(1),
      // what one viewer receives: the encoded stream, identical on both transports
      mbpsPerViewer: +(((cur.bytes[k][1] - prev.bytes[k][1]) * 8) / dt / 1e6).toFixed(2),
      wsMbpsAllViewers: +(((cur.bytes[k][0] - prev.bytes[k][0]) * 8) / dt / 1e6).toFixed(2),
    })),
  }
}

// ---------- HTTP + WebSocket ----------
const frames = []
const static_ = { "/": "viewer.html", "/viewer": "viewer.html", "/demo": "demo.html", "/canvas": "canvas.html" }
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x")
  if (static_[url.pathname]) {
    res.writeHead(200, { "content-type": "text/html" })
    return res.end(readFileSync(join(here, static_[url.pathname])))
  }
  if (url.pathname === "/stats") return json(res, 200, sample() ?? { primed: true })
  if (url.pathname === "/frames") return json(res, 200, { frames: frames.map((f) => f.i), width: W, height: H })
  // The agent: same driver gate as people. GET /agent/<frame>/screenshot is the real display, so
  // native popups (a <select>'s list) show up in it.
  const m = url.pathname.match(/^\/agent\/(\d+)\/(\w+)$/)
  if (m) {
    const frame = frames[+m[1]]
    if (!frame) return json(res, 404, { error: "no such frame" })
    const op = m[2]
    if (op === "screenshot") {
      const png = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-video_size", `${W}x${H}`, "-i", `${frame.display}.0`, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"])
      res.writeHead(200, { "content-type": "image/png" })
      return res.end(png)
    }
    const body = await new Promise((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => r(b ? JSON.parse(b) : {})) })
    if (op === "state") return json(res, 200, stateOf(frame))
    if (op === "request" || op === "release" || op === "grant") { control(frame, "agent", { type: op, ...body }); return json(res, 200, stateOf(frame)) }
    if (frame.driver !== "agent") return json(res, 409, { error: `agent isn't driving (driver: ${frame.driver ?? "nobody"})` })
    if (op === "click") {
      const e = { x: body.x, y: body.y, button: "left", clickCount: 1 }
      await frame.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...e, button: "none" })
      await frame.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...e, buttons: 1 })
      await frame.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...e, buttons: 0 })
    } else if (op === "type") await frame.cdp("Input.insertText", { text: body.text })
    else if (op === "key") {
      await frame.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: body.key, code: body.code ?? body.key, windowsVirtualKeyCode: body.keyCode ?? 0 })
      await frame.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: body.key, code: body.code ?? body.key, windowsVirtualKeyCode: body.keyCode ?? 0 })
    } else if (op === "scroll") await frame.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: body.x ?? W / 2, y: body.y ?? H / 2, deltaX: 0, deltaY: body.dy ?? 300 })
    else if (op === "eval") return json(res, 200, (await frame.cdp("Runtime.evaluate", { expression: body.expression, returnByValue: true })).result?.result?.value ?? null)
    else return json(res, 404, { error: "unknown op" })
    return json(res, 200, { ok: true })
  }
  res.writeHead(404).end()
})

const wss = new WebSocketServer({ server })
let viewerSeq = 0
wss.on("connection", (sock, req) => {
  const url = new URL(req.url, "http://x")
  const frame = frames[Number(url.searchParams.get("frame") ?? 0)]
  const transport = url.searchParams.get("transport") ?? "ws"
  const v = { sock, frame, who: url.searchParams.get("name") || `viewer-${++viewerSeq}`, pc: null, track: null }
  // webrtc viewers' sockets carry only control; their video arrives by RTP
  if (transport === "ws") frame.ws.add(v)
  else frame.wsControl = (frame.wsControl ?? new Set()).add(v)
  viewersChanged(frame)
  send(v, JSON.stringify({ type: "hello", you: v.who, width: W, height: H, codec: CODEC }))
  broadcastState(frame)
  if (transport === "ws") for (const msg of frame.gop) send(v, msg)
  sock.on("message", (raw) => later(async () => {
    const msg = JSON.parse(raw)
    if (msg.type === "input") { if (frame.driver === v.who) await dispatch(frame, msg); return }
    if (msg.type === "ping") return send(v, JSON.stringify({ type: "pong", t: msg.t }))
    if (msg.type === "answer") return v.pc.setRemoteDescription(msg.sdp)
    if (msg.type === "webrtc") {
      const pc = new RTCPeerConnection({
        codecs: { video: [new RTCRtpCodecParameters({ mimeType: CODEC === "h264" ? "video/H264" : "video/VP8", clockRate: 90000, payloadType: 96,
          rtcpFeedback: [{ type: "nack" }, { type: "nack", parameter: "pli" }],
          ...(CODEC === "h264" ? { parameters: "profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1" } : {}) })] },
      })
      const track = new MediaStreamTrack({ kind: "video" })
      pc.addTransceiver(track, { direction: "sendonly" })
      await pc.setLocalDescription(await pc.createOffer())
      await new Promise((r) => { if (pc.iceGatheringState === "complete") r(); else pc.iceGatheringStateChange.subscribe((s) => s === "complete" && r()) })
      v.pc = pc
      v.track = track
      frame.rtc.add(track)
      return send(v, JSON.stringify({ type: "offer", sdp: pc.localDescription }))
    }
    control(frame, v.who, msg)
  }))
  sock.on("close", () => {
    frame.ws.delete(v)
    frame.wsControl?.delete(v)
    if (v.track) frame.rtc.delete(v.track)
    v.pc?.close()
    // #981: a driver who leaves passes control to the oldest requester (prototype skips the 5s grace)
    if (frame.driver === v.who) frame.driver = frame.requests.shift() ?? null
    frame.requests = frame.requests.filter((r) => r !== v.who)
    viewersChanged(frame)
    broadcastState(frame)
  })
})

await new Promise((r) => server.listen(PORT, "127.0.0.1", r))
for (let i = 0; i < FRAMES; i++) frames.push(await startFrame(i))
sample()
console.log(`live frames on http://127.0.0.1:${PORT}/  (${FRAMES} frame${FRAMES > 1 ? "s" : ""}, ${W}x${H}@${FPS}, page=${PAGE || "still"}, delay=${DELAY}ms, ${CODEC}, pause=${PAUSE}${DECIMATE ? ", decimate" : ""})`)
