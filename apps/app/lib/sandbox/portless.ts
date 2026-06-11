import "server-only"

import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Where the portless CLI lives — a regular dependency of the app, resolved
 * from cwd like the sandbox-bridge files (`lib/sandbox-bridge/index.ts`):
 * both `next dev` and the desktop sidecar run with cwd at the app root, and
 * `build-sidecar.mjs` folds the package into the standalone tree at this
 * path. Spawned as `node <cli.js>` (it has no runtime dependencies), so the
 * host needs no global portless install.
 */
export function portlessCliPath(): string {
  return path.join(process.cwd(), "node_modules", "portless", "dist", "cli.js")
}

/**
 * The port the auto-started portless proxy daemon listens on. portless's own
 * documented unprivileged fallback (its CLI suggests exactly this port when it
 * can't sudo): below 1024 the daemon needs root, and the desktop sidecar's
 * no-TTY spawns can never answer a sudo prompt — the failure that made ADR
 * 0010's original "user runs `portless proxy start` once" prerequisite a
 * dead-on-arrival default. Named URLs carry the suffix
 * (`http://<name>.localhost:1355`); a user who wants port-free HTTPS URLs can
 * still run their own daemon on 443 (`portless service install`) — the
 * auto-start no-ops when any daemon is already up.
 */
export const PORTLESS_PROXY_PORT = 1355

/**
 * Where portless keeps its daemon state (`proxy.port`, the `proxy.tls`
 * marker) and route table (`routes.json`). Honors the same
 * `PORTLESS_STATE_DIR` override the CLI does — which is also the seam tests
 * point at a fixture dir.
 */
function portlessStateDir(): string {
  return (
    process.env.PORTLESS_STATE_DIR ?? path.join(os.homedir(), ".portless")
  )
}

/**
 * The stable named URL portless registered for a dev server bound to
 * `devPort`, or `null` when there's nothing to point at (daemon never wrote
 * state, no live route for that port). Reads the daemon's listen port and
 * TLS marker from its state dir and matches the route by its app port — the
 * per-Sandbox allocated port is unique on the host, so the match is exact.
 * Routes whose owning `portless run` died are filtered out by the store, so
 * a stale entry never surfaces as a live URL.
 *
 * Dynamic import on purpose: only the local backend ever calls this, and the
 * hosted server bundle shouldn't load the package at module scope for it.
 */
export async function lookupStableDevUrl(
  devPort: number
): Promise<string | null> {
  const dir = portlessStateDir()
  let proxyPort: number
  try {
    proxyPort = parseInt(
      readFileSync(path.join(dir, "proxy.port"), "utf8").trim(),
      10
    )
  } catch {
    return null
  }
  if (Number.isNaN(proxyPort)) return null
  const tls = existsSync(path.join(dir, "proxy.tls"))

  const { RouteStore, formatUrl } = await import("portless")
  const routes = new RouteStore(dir, { onWarning: () => {} }).loadRoutes()
  const route = routes.find((r) => r.port === devPort)
  return route ? formatUrl(route.hostname, proxyPort, tls) : null
}
