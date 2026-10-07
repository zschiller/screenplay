import "server-only"

import { WS_ROUTES } from "@/headless/ws-routes.mjs"
import { hostTunnel } from "@/lib/capabilities"
import { LOCAL_WS_TOKEN_PARAM, localWsSecret } from "@/lib/local-ws-guard"

/**
 * The local terminal server's URL for a target (`sandbox=<name>` or `host=1`),
 * carrying the per-launch secret the server checks on upgrade (#997). The
 * client keeps the query and appends its `?arg=`s (`terminalWebSocketUrl`).
 */
export function localTerminalUrl(
  port: number,
  target: { sandbox: string } | { host: "1" }
): string {
  const url = new URL(`http://localhost:${port}/`)
  for (const [key, value] of Object.entries(target)) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set(LOCAL_WS_TOKEN_PARAM, localWsSecret())
  // Headless: a path on the app's own origin, which the host listener pipes
  // to the server (`headless/ws-routes.mjs`); the client resolves it against
  // the page.
  if (hostTunnel) return `${WS_ROUTES.terminal}/${url.search}`
  return url.toString()
}
