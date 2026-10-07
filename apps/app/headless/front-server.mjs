// Headless's front server (#1930): it owns the sockets and hands requests to
// Next in the same process. The host listener binds 127.0.0.1 only, so
// whoever reaches it (over an SSH tunnel) is the host. It also carries the
// local Yjs and terminal WebSockets under a path each (`ws-routes.mjs`), so
// the host tunnels one port for the app and one, portless's, for frames.
//
// Plain Node, no TS: `pnpm headless` copies this folder into the standalone
// server and runs it with the standalone tree's `next`.

import { existsSync, readFileSync } from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { bannerLines } from "./banner.mjs"
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
 * listen on the host listener.
 *
 * @param {{ dir: string, port: number }} opts
 * @returns {Promise<import("node:http").Server>}
 */
export async function startFrontServer({ dir, port }) {
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
  return listenOnHost(
    createHostServer((req, res) => void handle(req, res)),
    port
  )
}

/**
 * The host listener's server: requests to `handle` (Next), socket routes
 * piped to their servers.
 *
 * @param {import("node:http").RequestListener} handle
 * @param {(name: "yjs" | "terminal") => number | undefined} [portOf]
 */
export function createHostServer(handle, portOf = localWsPort) {
  const server = http.createServer(handle)
  server.on("upgrade", (req, socket, head) =>
    pipeUpgrade(req, socket, head, portOf)
  )
  return server
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
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, HOST_ADDRESS, () => {
      server.off("error", reject)
      resolve(server)
    })
  })
}

/** Run as the server `pnpm headless` starts, configured by its environment. */
async function main() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  process.chdir(dir)
  const port = Number(process.env.PORT)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must name the host listener’s port")
  }
  await startFrontServer({ dir, port })
  const viewers = JSON.parse(process.env.SCREENPLAY_VIEWER_LISTENERS || "[]")
  const portlessPort = Number(process.env.SCREENPLAY_PORTLESS_PORT || 1355)
  console.log(bannerLines({ hostPort: port, portlessPort, viewers }).join("\n"))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
