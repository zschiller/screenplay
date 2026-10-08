// The front server (#1930, #1931): it owns the sockets and hands requests to
// Next in the same process. The Mac app's sidecar and `pnpm headless` both run
// it. The host listener binds 127.0.0.1 only, so whoever reaches it is the
// host. It also carries the local Yjs and terminal WebSockets under a path
// each (`ws-routes.mjs`), so a Headless host tunnels one port for the app and
// one, portless's, for frames.
//
// In the Mac app, each viewer listener (Sharing, #1921) binds the address it
// is given, serves only `viewer-allowlist.mjs`, and asks the Viewer identity
// who each request is from (`viewer.mjs`). The role comes from the listener a
// request arrived on, never from a header: both listeners strip a client's
// copy of the identity header before Next sees the request.
//
// Plain Node, no TS: the sidecar build and `pnpm headless` copy this folder
// into the standalone server and run it with the standalone tree's `next`.

import { existsSync, readFileSync } from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  REFUSAL_HEADER,
  REFUSED_PATH,
  VIEWER_HEADER,
  createIdentifier,
  setReservedHeader,
  stripReservedHeaders,
} from "./viewer.mjs"
import { VIEWER_ALLOWLIST, allowlistEntry } from "./viewer-allowlist.mjs"
import { localWsPort, matchWsRoute } from "./ws-routes.mjs"

/** The host listener's address. Never anything else: the role comes from it. */
export const HOST_ADDRESS = "127.0.0.1"

/**
 * Pipe a WebSocket upgrade on a socket route to its server's loopback port,
 * with the route's prefix taken off the path. Headers, the Origin the local
 * servers check among them, pass as received. Any other path is refused.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:stream").Duplex} socket
 * @param {Buffer} head
 * @param {(name: "yjs" | "terminal") => number | undefined} portOf
 */
export function pipeUpgrade(req, socket, head, portOf = localWsPort) {
  const route = matchWsRoute(req.url ?? "/")
  const port = route ? portOf(route.name) : undefined
  if (!route || !port) {
    socket.end(
      "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    )
    return
  }
  const upstream = net.connect(port, "127.0.0.1", () => {
    const lines = [`${req.method} ${route.path} HTTP/${req.httpVersion}`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on("error", () => socket.destroy())
  socket.on("error", () => upstream.destroy())
}

/**
 * Start Next from a built app folder (the standalone server's `apps/app`) and
 * listen on the host listener and each viewer listener.
 *
 * @param {{ dir: string, port: number, viewers?: ViewerListener[] }} opts
 * @returns {Promise<import("node:http").Server[]>}
 */
export async function startFrontServer({ dir, port, viewers = [] }) {
  process.env.NODE_ENV = "production"
  // The standalone `server.js` sets this before it loads Next; the config is
  // also what `required-server-files.json` records.
  const distDir = [path.join(".next", "headless"), ".next"].find((d) =>
    existsSync(path.join(dir, d, "required-server-files.json"))
  )
  if (!distDir) throw new Error(`No built app in ${dir}`)
  const { config } = JSON.parse(
    readFileSync(path.join(dir, distDir, "required-server-files.json"), "utf8")
  )
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config)
  const require = createRequire(path.join(dir, "server.js"))
  const next = require("next")
  const app = next({
    dev: false,
    dir,
    conf: config,
    hostname: HOST_ADDRESS,
    port,
    customServer: true,
  })
  await app.prepare()
  const handle = app.getRequestHandler()
  const toNext = (req, res) => void handle(req, res)
  const identify = createIdentifier()
  return Promise.all([
    listenOnHost(createHostServer(toNext), port),
    ...viewers.map((listener) =>
      listenOn(createViewerServer(toNext, listener, { identify }), listener)
    ),
  ])
}

/**
 * The host listener's server: requests to `handle` (Next), socket routes
 * piped to their servers.
 *
 * @param {import("node:http").RequestListener} handle
 * @param {(name: "yjs" | "terminal") => number | undefined} [portOf]
 */
export function createHostServer(handle, portOf = localWsPort) {
  const server = http.createServer((req, res) => {
    // The host is never identified: a client's copy of the identity header
    // is dropped, so app code never sees a viewer here.
    stripReservedHeaders(req)
    handle(req, res)
  })
  server.on("upgrade", (req, socket, head) => {
    stripReservedHeaders(req)
    pipeUpgrade(req, socket, head, portOf)
  })
  return server
}

/**
 * @typedef {{ name: string, address: string, port: number }} ViewerListener
 * @typedef {import("./viewer-allowlist.mjs").AllowlistEntry} AllowlistEntry
 */

/**
 * A viewer listener's server: the allowlist only, each request identified
 * before Next sees it. A write no entry allows is refused with 403. A viewer
 * with no identity gets the refused page, whatever they asked for; an
 * identified viewer gets Next for an allowed read, else 404. Every upgrade is
 * refused until viewers get the canvas's Yjs (#1932).
 *
 * @param {import("node:http").RequestListener} handle
 * @param {ViewerListener} listener
 * @param {{
 *   identify?: (request: import("@/lib/viewer-identity/types").ViewerRequest) => Promise<import("@/lib/viewer-identity/types").ViewerAnswer>
 *   allowlist?: AllowlistEntry[]
 * }} [opts]
 */
export function createViewerServer(
  handle,
  listener,
  { identify = createIdentifier(), allowlist = VIEWER_ALLOWLIST } = {}
) {
  const server = http.createServer((req, res) => {
    stripReservedHeaders(req)
    serveViewer(req, res, handle, listener, identify, allowlist).catch(
      (err) => {
        console.error(err)
        if (!res.headersSent) res.writeHead(500)
        res.end()
      }
    )
  })
  server.on("upgrade", (_req, socket) => {
    socket.end(
      "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    )
  })
  return server
}

async function serveViewer(req, res, handle, listener, identify, allowlist) {
  const method = req.method ?? "GET"
  const { pathname } = new URL(req.url ?? "/", "http://viewer.invalid")
  const entry = allowlistEntry(pathname, allowlist)
  const allowed = entry?.methods.includes(method) ?? false
  const reads = method === "GET" || method === "HEAD"
  if (!allowed && !reads) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Viewers can’t change anything here.")
    return
  }
  if (allowed && !entry.identify) {
    handle(req, res)
    return
  }
  const answer = await identify({
    headers: headersOf(req),
    remoteAddress: req.socket.remoteAddress ?? "",
    listener,
  })
  if (!answer.person) {
    req.url = REFUSED_PATH
    setReservedHeader(req, REFUSAL_HEADER, { message: answer.message })
    handle(req, res)
    return
  }
  if (!allowed) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Not found")
    return
  }
  setReservedHeader(req, VIEWER_HEADER, answer.person)
  handle(req, res)
}

/** The request's headers as received, as a fetch `Headers`. */
function headersOf(req) {
  const headers = new Headers()
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    try {
      headers.append(req.rawHeaders[i], req.rawHeaders[i + 1])
    } catch {
      // A header fetch can't hold; Node already accepted it, so skip it.
    }
  }
  return headers
}

/**
 * Listen on 127.0.0.1 only: nothing off the machine reaches the host
 * listener, so the host is whoever has a tunnel to it.
 *
 * @param {import("node:http").Server} server
 * @param {number} port
 * @returns {Promise<import("node:http").Server>}
 */
export function listenOnHost(server, port) {
  return listenOn(server, { address: HOST_ADDRESS, port })
}

/**
 * @param {import("node:http").Server} server
 * @param {{ address: string, port: number }} at
 * @returns {Promise<import("node:http").Server>}
 */
export function listenOn(server, { address, port }) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, address, () => {
      server.off("error", reject)
      resolve(server)
    })
  })
}

/**
 * The viewer listeners `SCREENPLAY_VIEWER_LISTENERS` names, as JSON: a list of
 * `{ name, address, port }`. Only the Mac app serves viewers (Sharing,
 * #1921); any other profile serves none.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {ViewerListener[]}
 */
export function viewerListenersOf(env) {
  const raw = env.SCREENPLAY_VIEWER_LISTENERS
  if (!raw) return []
  if (env.NEXT_PUBLIC_SCREENPLAY_PROFILE !== "desktop") {
    console.warn(
      "SCREENPLAY_VIEWER_LISTENERS is for the Mac app’s Sharing; ignoring it"
    )
    return []
  }
  const listeners = JSON.parse(raw)
  if (
    !Array.isArray(listeners) ||
    !listeners.every(
      (l) =>
        l &&
        typeof l.name === "string" &&
        typeof l.address === "string" &&
        Number.isInteger(l.port)
    )
  ) {
    throw new Error(
      "SCREENPLAY_VIEWER_LISTENERS must be a JSON list of { name, address, port }"
    )
  }
  return listeners
}

/** Run as the server the sidecar or `pnpm headless` starts, configured by its environment. */
async function main() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  process.chdir(dir)
  const port = Number(process.env.PORT)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must name the host listener’s port")
  }
  const viewers = viewerListenersOf(process.env)
  await startFrontServer({ dir, port, viewers })
  for (const viewer of viewers) {
    console.log(
      `[viewers] ${viewer.name} listening on ${viewer.address}:${viewer.port}`
    )
  }
  if (process.env.NEXT_PUBLIC_SCREENPLAY_PROFILE === "headless") {
    const { bannerLines } = await import("../headless/banner.mjs")
    const portlessPort = Number(process.env.SCREENPLAY_PORTLESS_PORT || 1355)
    console.log(bannerLines({ hostPort: port, portlessPort }).join("\n"))
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
