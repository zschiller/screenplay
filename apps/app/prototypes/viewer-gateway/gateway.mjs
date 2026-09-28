// PROTOTYPE (issue #991) — throwaway. Not wired into the app, never shipped.
//
// A read-only viewer gateway for ONE room hosted on this Mac. It is a separate
// process from the Next sidecar and serves exactly three things:
//
//   1. the app shell: GET-only, allowlisted paths, proxied from the sidecar
//   2. a one-way Yjs mirror of the room: the gateway keeps its own replica,
//      fed only by the sidecar; everything a viewer sends is dropped
//   3. frame previews: one origin per frame (f<port>.localhost), only for the
//      ports that the shared room's frames point at, GET/HEAD + HMR sockets
//
// Everything else answers 403/404 and is logged, so running it shows what the
// viewer UI tries to reach and what broke.
//
//   node gateway.mjs                     (on the Mac, app open)
//   SIDECAR=http://127.0.0.1:3947 ROOM=<roomId> node gateway.mjs
//
// Env:
//   SIDECAR   origin of the Next sidecar (default: found with lsof)
//   ROOM      the one room id this gateway shares (default: the room most
//             recently saved on this Mac)
//   YJS       sidecar's y-websocket origin (default ws://127.0.0.1:1234)
//   PORT      gateway port (default 4100); it binds 127.0.0.1 only

import http from "node:http"
import net from "node:net"
import { WebSocket, WebSocketServer } from "ws"
import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import { readdirSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

// lib0 is not a direct dependency of apps/app; load the copy y-protocols uses
// (pnpm puts it next to y-protocols), so both speak the same encoder.
const yProtocolsDir = dirname(
  realpathSync(createRequire(import.meta.url).resolve("y-protocols/package.json"))
)
const lib0 = (m) => import(pathToFileURL(join(yProtocolsDir, "..", "lib0", `${m}.js`)).href)
const encoding = await lib0("encoding")
const decoding = await lib0("decoding")

const SIDECAR = new URL(process.env.SIDECAR ?? (await findSidecar()))
const ROOM = process.env.ROOM === "latest" || !process.env.ROOM ? latestRoom() : process.env.ROOM
const YJS = process.env.YJS ?? "ws://127.0.0.1:1234"
const PORT = Number(process.env.PORT ?? 4100)

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MSG_QUERY_AWARENESS = 3

const YJS_PATH = `/__viewer/yjs/${ROOM}`

const stats = { dropped: {}, blocked: {}, served: {} }
function count(bucket, key) {
  bucket[key] = (bucket[key] ?? 0) + 1
  if (bucket[key] === 1) log(bucketName(bucket), key)
}
function bucketName(b) {
  return b === stats.dropped ? "DROP " : b === stats.blocked ? "BLOCK" : "serve"
}
function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a)
}
// On the Mac the sidecar listens on a random 127.0.0.1 port. Find it: the
// node process that answers /api/health with {"status":"ok"}.
async function findSidecar() {
  const { execSync } = await import("node:child_process")
  const out = execSync("lsof -nP -iTCP -sTCP:LISTEN -a -c node", { encoding: "utf8" })
  const ports = [...new Set([...out.matchAll(/127\.0\.0\.1:(\d+) \(LISTEN\)/g)].map((m) => m[1]))]
  for (const port of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (r.ok && (await r.text()).includes('"ok"')) return `http://127.0.0.1:${port}`
    } catch {}
  }
  console.error("no sidecar found; is the Screenplay app open? Or pass SIDECAR=http://127.0.0.1:<port>")
  process.exit(1)
}

// The most recently written room on the Mac, so ROOM can be left unset: open
// the room you want to share in the app, move something, then start this.
function latestRoom() {
  const dir =
    process.env.YJS_PERSISTENCE_DIR ??
    join(homedir(), "Library/Application Support/space.screenplay.desktop/yjs")
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith(".ydoc"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]
  if (!newest) {
    console.error(`no rooms in ${dir}; pass ROOM=<roomId>`)
    process.exit(1)
  }
  return decodeURIComponent(newest.f.slice(0, -".ydoc".length))
}

// ---------------------------------------------------------------------------
// 2. The one-way mirror
// ---------------------------------------------------------------------------

// The replica is written only by the upstream handler below. Nothing a viewer
// sends is ever applied to it, and nothing is ever sent upstream except the
// initial "what do you have" (sync step 1), so there is no path from a viewer
// to the sidecar's doc.
const replica = new Y.Doc()
const upstreamAwareness = new awarenessProtocol.Awareness(new Y.Doc())
upstreamAwareness.setLocalState(null) // the gateway itself has no presence
let upstreamSynced = false

function connectUpstream() {
  const ws = new WebSocket(`${YJS}/${ROOM}`)
  ws.binaryType = "arraybuffer"
  ws.on("open", () => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, replica)
    ws.send(encoding.toUint8Array(enc))
    log("mirror  connected upstream", `${YJS}/${ROOM}`)
  })
  ws.on("message", (data) => {
    const dec = decoding.createDecoder(new Uint8Array(data))
    const type = decoding.readVarUint(dec)
    if (type === MSG_SYNC) {
      const sub = decoding.readVarUint(dec)
      if (sub === syncProtocol.messageYjsSyncStep1) {
        // The sidecar asks what we have. We never answer: the replica only
        // holds what the sidecar sent, so there is nothing to give back.
        return
      }
      // step 2 or update: apply with origin "upstream"
      const update = decoding.readVarUint8Array(dec)
      Y.applyUpdate(replica, update, "upstream")
      if (sub === syncProtocol.messageYjsSyncStep2 && !upstreamSynced) {
        upstreamSynced = true
        log("mirror  synced", summarize())
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        upstreamAwareness,
        decoding.readVarUint8Array(dec),
        "upstream"
      )
    }
  })
  ws.on("close", () => {
    log("mirror  upstream closed, retrying in 1s")
    upstreamSynced = false
    setTimeout(connectUpstream, 1000)
  })
  ws.on("error", (e) => log("mirror  upstream error", e.message))
  // Guard: this socket is receive-only after the handshake. If any code path
  // ever tries to send more, fail loudly instead of writing upstream.
  const send = ws.send.bind(ws)
  let sentHandshake = false
  ws.send = (...args) => {
    if (sentHandshake) throw new Error("mirror tried to write upstream")
    sentHandshake = true
    return send(...args)
  }
}

function summarize() {
  const frames = replica.getMap("iframeLayers")
  return `(${frames.size} frames, ${replica.getMap("markdownLayers").size} docs, ${replica.getMap("chatSessions").size} chats)`
}

// Fan-out to viewers.
const viewers = new Set()
replica.on("update", (update, origin) => {
  if (origin !== "upstream") {
    // Can't happen by construction; if it does, the replica is no longer a
    // faithful mirror, so stop serving rather than serve something else.
    log("FATAL replica changed from a non-upstream origin", origin)
    process.exit(2)
  }
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_SYNC)
  syncProtocol.writeUpdate(enc, update)
  broadcast(encoding.toUint8Array(enc))
})
upstreamAwareness.on("update", ({ added, updated, removed }) => {
  const changed = added.concat(updated, removed)
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_AWARENESS)
  encoding.writeVarUint8Array(
    enc,
    awarenessProtocol.encodeAwarenessUpdate(upstreamAwareness, changed)
  )
  broadcast(encoding.toUint8Array(enc))
})
function broadcast(msg) {
  for (const v of viewers) if (v.readyState === WebSocket.OPEN) v.send(msg)
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
wss.on("connection", (ws) => {
  viewers.add(ws)
  log("viewer  joined, now", viewers.size)
  // Hand the viewer the whole replica as sync step 2, which is what flips a
  // y-websocket client to "synced". We never send step 1, so the viewer is
  // never asked for its state.
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_SYNC)
  syncProtocol.writeSyncStep2(enc, replica)
  ws.send(encoding.toUint8Array(enc))
  sendAwareness(ws)

  ws.on("message", (data) => {
    let type, sub
    try {
      const dec = decoding.createDecoder(new Uint8Array(data))
      type = decoding.readVarUint(dec)
      if (type === MSG_SYNC) sub = decoding.readVarUint(dec)
    } catch {
      return count(stats.dropped, "viewer: unparseable message")
    }
    if (type === MSG_SYNC && sub === syncProtocol.messageYjsSyncStep1) {
      // "What do you have?" — answer from the replica. Read-only.
      const enc2 = encoding.createEncoder()
      encoding.writeVarUint(enc2, MSG_SYNC)
      syncProtocol.writeSyncStep2(enc2, replica)
      ws.send(encoding.toUint8Array(enc2))
      return
    }
    if (type === MSG_QUERY_AWARENESS) return sendAwareness(ws)
    if (type === MSG_SYNC) return count(stats.dropped, "viewer: doc write")
    if (type === MSG_AWARENESS) return count(stats.dropped, "viewer: presence")
    count(stats.dropped, `viewer: message type ${type}`)
  })
  ws.on("close", () => {
    viewers.delete(ws)
    log("viewer  left, now", viewers.size)
  })
})
function sendAwareness(ws) {
  const clients = [...upstreamAwareness.getStates().keys()]
  if (!clients.length) return
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_AWARENESS)
  encoding.writeVarUint8Array(
    enc,
    awarenessProtocol.encodeAwarenessUpdate(upstreamAwareness, clients)
  )
  ws.send(encoding.toUint8Array(enc))
}

// ---------------------------------------------------------------------------
// 3. Frames: one origin per frame, only this room's frame ports
// ---------------------------------------------------------------------------

/** Ports the shared room's frames point at, read from the replica. */
function allowedFramePorts() {
  const ports = new Map() // port -> frame name, for logs
  // A frame's URL is its Workspace's preview address
  // (branches.<id>.previewDomain, which canvas-member-layer.tsx hands the frame).
  // Only Workspaces that some frame in the room shows count.
  const shown = new Set()
  replica.getMap("iframeLayers").forEach((layer) => {
    const b = layer.get?.("branchId")
    if (b) shown.add(b)
  })
  replica.getMap("branches").forEach((branch, id) => {
    if (!shown.has(id)) return
    const url = branch.get?.("previewDomain")
    if (typeof url !== "string") return
    try {
      const u = new URL(url)
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1")
        ports.set(Number(u.port || 80), branch.get("title") ?? id)
    } catch {}
  })
  return ports
}

/** `f4101.localhost:4100` -> 4101, else null. */
function framePortFromHost(host) {
  const m = /^f(\d+)\.localhost(?::\d+)?$/i.exec(host ?? "")
  return m ? Number(m[1]) : null
}

function proxyFrame(req, res, port) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    count(stats.blocked, `frame ${req.method} (read-only)`)
    res.writeHead(405).end("read-only")
    return
  }
  const headers = { ...req.headers, host: `127.0.0.1:${port}` }
  delete headers.origin
  delete headers.cookie // the viewer's cookies stay out of the dev server
  const up = http.request(
    { host: "127.0.0.1", port, method: req.method, path: req.url, headers },
    (upRes) => {
      const h = { ...upRes.headers }
      delete h["set-cookie"]
      res.writeHead(upRes.statusCode ?? 502, h)
      upRes.pipe(res)
    }
  )
  up.on("error", () => res.writeHead(502).end("frame not reachable"))
  up.end()
}

function upgradeFrame(req, socket, head, port) {
  // HMR sockets. They are two-way by nature; see the ticket write-up.
  const up = net.connect(port, "127.0.0.1", () => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` }
    delete headers.origin
    delete headers.cookie
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`)
    up.write(`GET ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`)
    if (head?.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on("error", () => socket.destroy())
  socket.on("error", () => up.destroy())
}

// ---------------------------------------------------------------------------
// 1. The app shell: GET-only allowlist, proxied from the sidecar
// ---------------------------------------------------------------------------

const SHELL_ALLOW = [
  (p) => p === `/${ROOM}`, // the room page (and its ?_rsc= payloads)
  (p) => p.startsWith("/_next/static/"),
  (p) => p === "/icon" || p.startsWith("/icon?") || p === "/favicon.ico",
]

// Injected into the shell's HTML. Two rewrites, both in the viewer's browser:
//  - the Yjs socket (the app dials `ws://<host>:1234/<room>`) goes to the
//    gateway's mirror instead, so the viewer never touches the sidecar's port
//  - frame URLs (`http://localhost:<port>`) go to the frame's own origin
const SHIM = `<script>(() => {
  const gw = location.host
  const NativeWS = window.WebSocket
  window.WebSocket = function (url, protocols) {
    const u = new URL(url, location.href)
    if (u.port === "1234") url = "ws://" + gw + "${YJS_PATH}"
    return protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols)
  }
  window.WebSocket.prototype = NativeWS.prototype
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  const rewrite = (src) => {
    try {
      const u = new URL(src, location.href)
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1")
        if (u.port && u.port !== location.port)
          return "http://f" + u.port + ".localhost:" + location.port + u.pathname + u.search + u.hash
    } catch {}
    return src
  }
  const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src")
  Object.defineProperty(HTMLIFrameElement.prototype, "src", {
    get() { return desc.get.call(this) },
    set(v) { desc.set.call(this, rewrite(v)) },
  })
  const setAttr = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (n, v) {
    if (this instanceof HTMLIFrameElement && n === "src") v = rewrite(v)
    return setAttr.call(this, n, v)
  }
})()</script>`

function proxyShell(req, res) {
  const path = req.url.split("?")[0]
  if (req.method !== "GET" && req.method !== "HEAD") {
    count(stats.blocked, `shell ${req.method} ${path}${req.headers["next-action"] ? " (server action)" : ""}`)
    res.writeHead(405).end("read-only")
    return
  }
  // Found by this prototype: without this, `/_next/static/../../api/health`
  // (or `%2e%2e`) passes the prefix check and Next resolves it to an API
  // route. Any allowlist in front of the full sidecar is one slip away from
  // this, which is the argument for serving the shell from the gateway's own
  // files instead of proxying the sidecar (see the write-up).
  if (/\.\.|%2e|%2f|%5c|\\/i.test(path)) {
    count(stats.blocked, `shell traversal ${path}`)
    res.writeHead(400).end("bad path")
    return
  }
  if (!SHELL_ALLOW.some((ok) => ok(path))) {
    count(stats.blocked, `shell GET ${path}`)
    res.writeHead(404).end("not shared")
    return
  }
  count(stats.served, `shell GET ${path.startsWith("/_next/static/") ? "/_next/static/*" : path}`)
  const headers = { ...req.headers, host: SIDECAR.host }
  delete headers.cookie
  delete headers.origin
  headers["accept-encoding"] = "identity"
  const up = http.request(
    {
      host: SIDECAR.hostname,
      port: SIDECAR.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (upRes) => {
      const h = { ...upRes.headers }
      delete h["set-cookie"]
      const html = String(h["content-type"] ?? "").startsWith("text/html")
      if (!html) {
        res.writeHead(upRes.statusCode ?? 502, h)
        return upRes.pipe(res)
      }
      const chunks = []
      upRes.on("data", (c) => chunks.push(c))
      upRes.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf8")
        body = body.replace(/<head([^>]*)>/i, (m) => m + SHIM)
        delete h["content-length"]
        delete h["transfer-encoding"]
        res.writeHead(upRes.statusCode ?? 502, h)
        res.end(body)
      })
    }
  )
  up.on("error", () => res.writeHead(502).end("sidecar not reachable"))
  up.end()
}

// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const framePort = framePortFromHost(req.headers.host)
  if (framePort !== null) {
    const allowed = allowedFramePorts()
    if (!allowed.has(framePort)) {
      count(stats.blocked, `frame port ${framePort} (not a frame in this room)`)
      return res.writeHead(403).end("not shared")
    }
    count(stats.served, `frame ${framePort} (${allowed.get(framePort)})`)
    return proxyFrame(req, res, framePort)
  }
  if (req.url === "/__viewer/stats") {
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify({ viewers: viewers.size, replica: summarize(), ...stats }, null, 2))
  }
  proxyShell(req, res)
})

server.on("upgrade", (req, socket, head) => {
  const framePort = framePortFromHost(req.headers.host)
  if (framePort !== null) {
    if (!allowedFramePorts().has(framePort)) return socket.destroy()
    count(stats.served, `frame ${framePort} websocket ${req.url.split("?")[0]}`)
    return upgradeFrame(req, socket, head, framePort)
  }
  if (req.url.split("?")[0] === YJS_PATH) {
    return wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req)
    )
  }
  if (process.env.DEV_HMR === "1" && req.url.startsWith("/_next/webpack-hmr")) {
    // Only when the sidecar is `next dev` (the web harness). A packaged Mac
    // sidecar is a production build and has no HMR socket.
    count(stats.served, "shell websocket /_next/webpack-hmr (DEV_HMR)")
    return upgradeFrame(req, socket, head, Number(SIDECAR.port))
  }
  count(stats.blocked, `websocket ${req.url.split("?")[0]}`)
  socket.destroy()
})

connectUpstream()
server.listen(PORT, "127.0.0.1", () => {
  log(`gateway http://127.0.0.1:${PORT}/${ROOM}  (sidecar ${SIDECAR.origin})`)
  log(`frames  http://f<port>.localhost:${PORT}/  stats /__viewer/stats`)
})
