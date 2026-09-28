// PROTOTYPE (#982): serve the demo site with a DOM recorder in it, plus a host
// tab, a watcher tab, and a relay that counts every byte the mirror costs.
//
//   npm install && node serve.mjs
//   open http://127.0.0.1:4100/host.html          (the live copy runs here)
//   open http://127.0.0.1:4100/watcher.html       (a mirror; press Drive)
//
// Ports: 4100 canvas + relay, 4101 the demo site ("dev server"), 4102 a
// cross-origin widget the lab page embeds.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import { build } from "esbuild"
import { WebSocketServer } from "ws"

const here = dirname(fileURLToPath(import.meta.url))
const NORTHWIND = resolve(here, "../../../screenshots/docs/northwind")
const PACKAGES = resolve(here, "../../../../../packages")
const OUT = join(here, ".build")
const MODULES = join(here, "node_modules")

async function buildSite() {
  const src = join(OUT, "src-tree")
  await rm(OUT, { recursive: true, force: true })
  await cp(NORTHWIND, src, { recursive: true })
  await cp(join(here, "lab/Lab.jsx"), join(src, "src/pages/Lab.jsx"))
  const app = join(src, "src/App.jsx")
  await writeFile(
    app,
    (await readFile(app, "utf8"))
      .replace('import { Customers } from "./pages/Customers.jsx"', 'import { Customers } from "./pages/Customers.jsx"\nimport { Lab, LAB_CSS } from "./pages/Lab.jsx"')
      .replace('path.startsWith("/customers") ? Customers :', 'path.startsWith("/customers") ? Customers : path.startsWith("/lab") ? Lab :')
      .replace('<Link to="/customers">Customers</Link>', '<Link to="/customers">Customers</Link><Link to="/lab">Lab</Link>')
      .replace("<nav ", "<style>{LAB_CSS}</style><nav ")
  )
  const shared = {
    bundle: true,
    format: "esm",
    jsx: "automatic",
    loader: { ".js": "jsx", ".woff2": "file", ".woff": "file" },
    define: { "process.env.NODE_ENV": '"development"' },
    alias: {
      "@screenplay.space/knobs": join(PACKAGES, "screenplay-knobs"),
      "@screenplay.space/state": join(PACKAGES, "screenplay-state"),
      react: join(MODULES, "react"),
      "react-dom": join(MODULES, "react-dom"),
    },
    nodePaths: [MODULES],
    logLevel: "error",
  }
  await build({ ...shared, entryPoints: [join(src, "src/main.jsx")], outdir: join(OUT, "site/assets"), entryNames: "app", assetNames: "[name]-[hash]", publicPath: "/assets" })
  await build({ ...shared, format: "iife", entryPoints: [join(here, "recorder.js")], outfile: join(OUT, "site/__recorder.js") })
  await build({ ...shared, entryPoints: [join(here, "app.js")], outfile: join(OUT, "canvas/app.js") })
  const html = (await readFile(join(src, "index.html"), "utf8"))
    .replace(/<script type="module" src="[^"]*"><\/script>/, '<script type="module" src="/assets/app.js"></script>')
    .replace("</head>", '<link rel="stylesheet" href="/assets/app.css" />\n<script src="/__recorder.js"></script>\n</head>')
  await writeFile(join(OUT, "site/index.html"), html)
  await cp(join(here, "clip.webm"), join(OUT, "site/clip.webm"))
  await writeFile(
    join(OUT, "site/photo.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="236" height="90"><defs><linearGradient id="g"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="236" height="90" rx="10" fill="url(#g)"/><text x="118" y="52" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">localhost asset</text></svg>`
  )
  await mkdir(join(OUT, "canvas"), { recursive: true })
  for (const f of ["host.html", "watcher.html"]) await cp(join(here, f), join(OUT, "canvas", f))
  await cp(join(MODULES, "rrweb/dist/style.css"), join(OUT, "canvas/rrweb.css"))
  await rm(src, { recursive: true, force: true })
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".webm": "video/webm" }

function serveDir(dir, port, { spa = false, extra } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x")
    if (extra && (await extra(url, req, res))) return
    let file = join(dir, decodeURIComponent(url.pathname))
    if (!extname(file)) file = spa ? join(dir, "index.html") : file
    try {
      const body = await readFile(file)
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store", "access-control-allow-origin": "*" })
      res.end(body)
    } catch {
      res.writeHead(404).end("not found")
    }
  })
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)))
}

// ---- The relay: a stand-in for the room's Yjs connection ------------------

const RR_SOURCES = ["mutation", "mousemove", "mouse-interaction", "scroll", "viewport", "input", "touch", "media", "stylesheet", "canvas", "font", "log", "drag", "style-declaration", "selection", "adopted-stylesheet"]
function category(e) {
  if (e.type === 2) return "full-snapshot"
  if (e.type === 4) return "meta"
  if (e.type === 3) return RR_SOURCES[e.data.source] ?? `source-${e.data.source}`
  return `type-${e.type}`
}

const config = { latency: 0 }
let stats
function resetStats() {
  stats = { since: Date.now(), up: {}, upBytes: 0, upMessages: 0, inputBytes: 0, inputMessages: 0, frames: [] }
}
resetStats()

const peers = new Set()
const room = { driver: null }
let backlog = [] // events since the last full snapshot, for late joiners

function roomMessage() {
  return JSON.stringify({ t: "room", driver: room.driver, peers: [...peers].map((p) => ({ name: p.name, role: p.role })) })
}
function later(fn) {
  if (config.latency > 0) setTimeout(fn, config.latency)
  else fn()
}
function broadcastRoom() {
  const m = roomMessage()
  for (const p of peers) p.ws.send(m)
}

async function main() {
  await buildSite()
  await serveDir(join(OUT, "site"), 4101, { spa: true })
  await serveDir(join(here, "xo"), 4102)
  const canvas = await serveDir(join(OUT, "canvas"), 4100, {
    extra: async (url, req, res) => {
      if (url.pathname === "/stats") {
        const all = Buffer.from(stats.frames.join("\n"))
        const body = { seconds: (Date.now() - stats.since) / 1000, upBytes: stats.upBytes, upMessages: stats.upMessages, upGzipBytes: gzipSync(all).length, byCategory: stats.up, inputBytes: stats.inputBytes, inputMessages: stats.inputMessages, watchers: [...peers].filter((p) => p.role === "watcher").length }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body, null, 2))
        return true
      }
      if (url.pathname === "/stats/reset") {
        resetStats()
        res.writeHead(200).end("ok")
        return true
      }
      if (url.pathname === "/snapshot") {
        for (const p of peers) if (p.role === "host") p.ws.send(JSON.stringify({ t: "snapshot" }))
        res.writeHead(200).end("ok")
        return true
      }
      if (url.pathname === "/config") {
        if (url.searchParams.has("latency")) config.latency = Number(url.searchParams.get("latency"))
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(config))
        return true
      }
      if (url.pathname === "/") {
        res.writeHead(302, { location: "/host.html" }).end()
        return true
      }
      return false
    },
  })

  const wss = new WebSocketServer({ server: canvas, path: "/relay" })
  wss.on("connection", (ws) => {
    const peer = { ws, name: "?", role: "?" }
    ws.on("message", (raw) => {
      const text = raw.toString()
      const m = JSON.parse(text)
      if (m.t === "hello") {
        peer.name = m.name
        peer.role = m.role
        peers.add(peer)
        if (m.role === "host" && !room.driver) room.driver = m.name
        if (m.role === "watcher" && backlog.length) ws.send(JSON.stringify({ t: "backlog", events: backlog }))
        broadcastRoom()
      } else if (m.t === "drive") {
        // #981 settles how control changes hands; the prototype just sets it.
        room.driver = m.name
        broadcastRoom()
      } else if (m.t === "rr") {
        const c = category(m.e)
        const bucket = (stats.up[c] ??= { bytes: 0, messages: 0 })
        bucket.bytes += text.length
        bucket.messages++
        stats.upBytes += text.length
        stats.upMessages++
        stats.frames.push(text)
        if (m.e.type === 4) backlog = []
        backlog.push(m.e)
        later(() => {
          for (const p of peers) if (p.role === "watcher") p.ws.send(text)
        })
      } else if (m.t === "input") {
        stats.inputBytes += text.length
        stats.inputMessages++
        later(() => {
          for (const p of peers) if (p.role === "host") p.ws.send(text)
        })
      } else if (m.t === "result") {
        later(() => {
          for (const p of peers) if (p.name === m.to) p.ws.send(text)
        })
      }
    })
    ws.on("close", () => {
      peers.delete(peer)
      broadcastRoom()
    })
  })
  console.log("host:    http://127.0.0.1:4100/host.html?path=/lab")
  console.log("watcher: http://127.0.0.1:4100/watcher.html?name=Avery")
  console.log("stats:   http://127.0.0.1:4100/stats")
}

main()
