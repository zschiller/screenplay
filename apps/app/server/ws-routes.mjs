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
