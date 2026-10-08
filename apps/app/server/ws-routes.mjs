// The local WebSocket servers (Yjs sync and the terminal) as the host
// listener carries them on Headless (#1930): under a path on the app's own
// origin, so the host tunnels one port for the app and its sockets. The front
// server (`front-server.mjs`) pipes each path to the server's loopback port,
// which the server registers here as it listens.
//
// Plain Node, no TS: the front server loads it outside the app's bundles.

/** The path each socket server is served under on the host listener. */
export const WS_ROUTES = {
  yjs: "/_ws/yjs",
  terminal: "/_ws/terminal",
}

const PORTS = Symbol.for("screenplay.localWsPorts")

/** Record the loopback port a socket server listens on (`instrumentation.ts`). */
export function setLocalWsPort(name, port) {
  globalThis[PORTS] ??= {}
  globalThis[PORTS][name] = port
}

/** The loopback port a socket server listens on, once it does. */
export function localWsPort(name) {
  return globalThis[PORTS]?.[name]
}

/**
 * Which socket server an upgrade's path belongs to, and the path that server
 * expects (the route's prefix taken off), or null for any other path.
 */
export function matchWsRoute(url) {
  for (const [name, prefix] of Object.entries(WS_ROUTES)) {
    if (
      url === prefix ||
      url.startsWith(`${prefix}/`) ||
      url.startsWith(`${prefix}?`)
    ) {
      const rest = url.slice(prefix.length)
      return { name, path: rest.startsWith("/") ? rest : `/${rest}` }
    }
  }
  return null
}

const VIEWER_YJS = Symbol.for("screenplay.viewerYjs")

/**
 * Register what takes a viewer's Yjs socket (Sharing, #1932): the local Yjs
 * server, once it listens. The front server hands it upgrades it has already
 * checked (the canvas link's key and the viewer's identity), so the socket
 * never meets the host's per-launch secret.
 */
export function setViewerYjs(accept) {
  globalThis[VIEWER_YJS] = accept
}

/** What takes a viewer's Yjs socket, once the Yjs server listens. */
export function viewerYjs() {
  return globalThis[VIEWER_YJS]
}

/** The close code a viewer's canvas socket gets when Sharing turns off (#1953). */
export const SHARING_OFF_CLOSE_CODE = 4001

/** The close reason that goes with it. */
export const SHARING_OFF_REASON = "sharing off"

const VIEWER_YJS_CLOSE = Symbol.for("screenplay.viewerYjsClose")

/**
 * Register how the local Yjs server ends every viewer's canvas socket, so
 * turning Sharing off (#1953) tells each open page why before the viewer
 * listener closes.
 */
export function setViewerYjsClose(close) {
  globalThis[VIEWER_YJS_CLOSE] = close
}

/** End every viewer's canvas socket, if the Yjs server listens. */
export async function closeViewerYjs() {
  await globalThis[VIEWER_YJS_CLOSE]?.()
}
