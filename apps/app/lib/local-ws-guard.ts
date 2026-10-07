import "server-only"

import { randomBytes, timingSafeEqual } from "node:crypto"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"

/**
 * The gate in front of the desktop build's localhost WebSocket servers (the
 * Yjs sync server and the terminal server, #997). Both listen on loopback only,
 * which keeps the LAN out; this gate keeps out the two callers loopback lets in:
 *
 *  - **Web pages** in the user's browser. Browsers don't apply CORS to
 *    WebSockets, so any page can open `ws://localhost:<port>`. The browser does
 *    stamp the page's `Origin` on the handshake, and a page can't forge it, so
 *    an upgrade is accepted only from the app's own origin.
 *  - **Blind local processes** (a prototype's dev server, anything else on the
 *    Mac) that know the port but not the per-launch secret the sidecar hands its
 *    own client through `/api/yjs/auth` and the terminal URL routes.
 *
 * So a new Node client (a harness fixture, a script) sends `origin` and the
 * token, as `screenshots/fixtures/workspace-lifecycle.ts` does.
 */

export const LOCAL_WS_TOKEN_PARAM = "token"

const SECRET_KEY = Symbol.for("screenplay.localWsSecret")
type SecretHost = typeof globalThis & { [SECRET_KEY]?: string }

/**
 * The secret the local WebSocket servers require, minted once per sidecar
 * launch and held only in memory. Cached on `globalThis` because Next can
 * evaluate the routes that hand it out and `instrumentation.ts` (which starts
 * the servers) in separate module graphs.
 */
export function localWsSecret(): string {
  const host = globalThis as SecretHost
  host[SECRET_KEY] ??= randomBytes(32).toString("base64url")
  return host[SECRET_KEY]
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * The port the app itself is served from. Next writes the port it actually
 * bound back into `PORT` (the desktop shell and the screenshot harness set it
 * up front), so this is read per request rather than once.
 */
function appPort(): string {
  return process.env.PORT || "3000"
}

/** Whether `origin` is the app's own: a loopback host on the app's port. */
export function isAppOrigin(
  origin: string | undefined,
  port: string = appPort()
): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.port === port
  )
}

function sameSecret(given: string | null, secret: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface GuardOptions {
  /** The secret to require. Defaults to {@link localWsSecret}. */
  secret?: string
  /** The app's port, for the Origin check. Defaults to `PORT`. */
  appPort?: string
}

/**
 * Check an upgrade request: `403` for a missing or foreign `Origin`, `401` for
 * a missing or wrong secret, `null` when it may proceed.
 */
export function checkLocalUpgrade(
  req: IncomingMessage,
  opts: GuardOptions = {}
): 401 | 403 | null {
  if (!isAppOrigin(req.headers.origin, opts.appPort)) return 403
  const url = new URL(req.url ?? "/", "http://localhost")
  const token = url.searchParams.get(LOCAL_WS_TOKEN_PARAM)
  if (!sameSecret(token, opts.secret ?? localWsSecret())) return 401
  return null
}

/** Refuse an upgrade before the handshake, with a plain HTTP status. */
export function rejectUpgrade(socket: Duplex, status: 401 | 403): void {
  const text = status === 401 ? "Unauthorized" : "Forbidden"
  socket.end(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  )
}
