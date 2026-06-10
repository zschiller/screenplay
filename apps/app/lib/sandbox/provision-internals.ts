import "server-only"

import type { SandboxInstance } from "@/lib/sandbox"

// 30 minutes — keep sandboxes alive only while actively used.
// sandboxProvider.get with resume:true will reboot the VM when a user returns.
export const SANDBOX_TIMEOUT = 30 * 60 * 1000
// 24 hours — snapshots preserve the full filesystem (node_modules etc.)
export const SNAPSHOT_EXPIRATION = 24 * 60 * 60 * 1000
// 1 vCPU = 2048 MB memory — sufficient for a Node.js dev server
export const SANDBOX_VCPUS = 1

// Offset between the user's dev port and the bridge proxy's public port.
// Far enough from typical monorepo ports (3001, 4200, 5173, 8080…) that a
// dev script running multiple apps in-sandbox can't collide with the proxy.
export const PROXY_PORT_OFFSET = 1000

// Forwarded port the BYO-harness web-terminal daemon (ttyd) listens on. Fixed
// (not derived from the dev port) and far from the dev/proxy pair so a user's
// dev script can't collide with it. Must be in the `ports` a sandbox is created
// with for `domain(TERMINAL_PORT)` to be reachable. 7681 is ttyd's conventional
// port.
export const TERMINAL_PORT = 7681

export const SANDBOX_LOG_PATH = "/tmp/screenplay/sandbox.log"
// Pidfiles for the dev server and proxy. Both are launched under `setsid` so
// their PID equals their PGID — the stop path uses these to SIGKILL the whole
// process group in one shot, catching every child that a port-based kill
// would otherwise miss (Next compile workers, esbuild, the proxy respawn loop).
const PIDFILE_DEV = "/tmp/screenplay/dev.pid"
const PIDFILE_PROXY = "/tmp/screenplay/proxy.pid"

// Env vars to make install output readable and live-streamable:
// - PNPM_CONFIG_REPORTER=append-only: pnpm prints line-by-line install
//   progress (vs. its default silent/summary mode when not on a TTY)
// - NPM_CONFIG_PROGRESS=false: disables the animated progress bar npm
//   tries to use (which uses carriage returns that look ugly in a log)
// - FORCE_COLOR / CLICOLOR_FORCE / TERM: keep ANSI colors enabled
const LOG_ENV = [
  "FORCE_COLOR=1",
  "CLICOLOR_FORCE=1",
  "TERM=xterm-256color",
  "PNPM_CONFIG_REPORTER=append-only",
  "NPM_CONFIG_PROGRESS=false",
].join(" ")

/**
 * Named, user-visible failure for a dev script that ignored the port contract:
 * the bridge proxy is up and reachable, but the dev server never listened on
 * its assigned (resolved) port past the probe window. Raised only where logical
 * ≠ bound (the local backend) — on an identity backend a dev server's default
 * port IS the assigned port, so this failure mode can't exist there. Distinct
 * from generic dev-server-crash failures so the user is told what to fix
 * instead of staring at a dead iframe.
 */
export class DevServerPortIgnoredError extends Error {
  constructor() {
    super(
      "The dev server never listened on its assigned port. Your dev script " +
        "must forward $SCREENPLAY_PORT to the dev server — e.g. " +
        '"next dev --port $SCREENPLAY_PORT" or "vite --port $SCREENPLAY_PORT". ' +
        "Update the dev script in the Project settings, then restart the dev server."
    )
    this.name = "DevServerPortIgnoredError"
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Run a command in the sandbox with stdout+stderr tee'd to the shared
 * sandbox log file so the Logs panel can surface the full startup output
 * (npm install, git pull, dev server, etc.). The command's exit code is
 * preserved. Callers that need stdout content should still use
 * `sandbox.runCommand` directly — this helper discards buffered output.
 */
export async function runLogged(
  sandbox: SandboxInstance,
  cmd: string,
  args: string[],
  options: { env?: Record<string, string>; label?: string } = {}
) {
  const label =
    options.label ?? `${cmd}${args.length ? " " + args.join(" ") : ""}`
  const header = shellQuote(`\n$ ${label}\n`)
  const quotedCmd = [cmd, ...args].map(shellQuote).join(" ")
  const sh =
    `mkdir -p /tmp/screenplay; ` +
    `printf %s ${header} >> ${SANDBOX_LOG_PATH} 2>/dev/null; ` +
    `${LOG_ENV} ${quotedCmd} >> ${SANDBOX_LOG_PATH} 2>&1; ` +
    `printf '[exit %s]\\n' $? >> ${SANDBOX_LOG_PATH} 2>/dev/null`
  return sandbox.runCommand({
    cmd: "sh",
    args: ["-c", sh],
    ...(options.env ? { env: options.env } : {}),
  })
}

/**
 * Write the in-sandbox HTML-injecting proxy and DOM bridge script to
 * /tmp/screenplay/. Idempotent — safe to call on every dev-server start.
 * Uses /tmp because commands run as the `vercel-sandbox` user, which has no
 * read access to /root. Throws if the write fails so callers running through
 * the runner surface a redacted failure result.
 */
export async function writeBridgeFiles(
  sandbox: SandboxInstance
): Promise<void> {
  const { PROXY_JS, BRIDGE_JS } = await import("@/lib/sandbox-bridge")
  await sandbox.writeFiles([
    { path: "/tmp/screenplay/proxy.mjs", content: PROXY_JS },
    { path: "/tmp/screenplay/bridge.js", content: BRIDGE_JS },
  ])
}

/**
 * Tear down any dev server and proxy supervisor a previous launch left running.
 * Both were started under `setsid`, so the PID recorded in each pidfile is its
 * own process-group leader: `kill -KILL -<pid>` takes down the supervisor loop,
 * its current child (the dev server / proxy node), and that child's own children
 * (Next compile workers, esbuild) in a single group kill — the only reliable way
 * to catch every descendant a port-based kill would miss. The plain `kill -KILL
 * <pid>` is a fallback for the rare case the PID isn't a group leader. Stale or
 * missing pidfiles (a fresh VM, a snapshot whose recorded PIDs don't exist in
 * the new process namespace) are harmless: the kills no-op and we remove the
 * files. Always succeeds — a relaunch must not be blocked by a failed cleanup.
 *
 * This is what makes {@link launchDevAndProxy} idempotent: without it, a second
 * launch into a still-live VM (a reconnect whose preview probe transiently
 * failed, racing reconnects, a restart over a running server) stacks a second
 * supervisor on top of the first. The new dev server then loses the port and
 * can't acquire `.next/dev/lock`, so it exit-1s and the supervisor respawns it
 * every second forever — and the overwritten pidfile orphans the original.
 */
export async function stopDevAndProxy(sandbox: SandboxInstance): Promise<void> {
  const kill =
    `for f in ${PIDFILE_DEV} ${PIDFILE_PROXY}; do ` +
    `p=$(cat "$f" 2>/dev/null); ` +
    `if [ -n "$p" ]; then kill -KILL "-$p" 2>/dev/null; kill -KILL "$p" 2>/dev/null; fi; ` +
    `done; ` +
    `rm -f ${PIDFILE_DEV} ${PIDFILE_PROXY} 2>/dev/null; true`
  await sandbox.runCommand({ cmd: "sh", args: ["-c", kill] })
}

/**
 * Launch both the user's dev server and the bridge proxy. First tears down any
 * dev/proxy supervisor a previous launch left running (so a relaunch into a
 * live VM replaces the old server instead of stacking a second one that fights
 * it for the port and `.next/dev/lock`), then installs the bridge files
 * (idempotent). Returns the preview domain pointing at the proxy port (port +
 * PROXY_PORT_OFFSET) rather than the devserver port. Throws if the bridge
 * install fails — callers running through the runner turn that into a redacted
 * failure result.
 *
 * **Ports are resolved through the sandbox's `hostPort` seam end-to-end.**
 * `port` is the Repo's *logical* Dev Server Port; what the dev server must
 * actually bind is `hostPort(port)` (identity on the hosted backend, a
 * per-Sandbox allocated port on the local backend, where every Sandbox shares
 * the host's network). The resolved value is handed to the dev command as
 * `$SCREENPLAY_PORT` (and `$PORT`) — the dev-script contract: the Repo's
 * configured dev script forwards it (e.g. `next dev --port $SCREENPLAY_PORT`).
 * The proxy binds its resolved listen port and upstreams to the resolved dev
 * port, so the launch, the advertised preview URL (`domain`, which maps the
 * same way), and what's actually listening always agree.
 */
export async function launchDevAndProxy(
  sandbox: SandboxInstance,
  port: number,
  devScript?: string,
  env?: Record<string, string> | null
): Promise<string> {
  await stopDevAndProxy(sandbox)
  await writeBridgeFiles(sandbox)

  const devPort = sandbox.hostPort(port)
  const proxyPort = sandbox.hostPort(port + PROXY_PORT_OFFSET)
  const dev = devScript?.trim() || "npm run dev"
  const devHeader = shellQuote(`\n$ ${dev}\n`)
  // Launch the dev server under a restart-on-crash supervisor, mirroring the
  // proxy below, so a crashed dev server comes back on its own without any
  // reload or reconnect. `setsid` makes the supervisor the leader of a new
  // session, so the PID we record equals its PGID — the stop path uses
  // `kill -KILL -<pid>` to take down the whole process group (the supervisor
  // loop, its current dev child, and that child's own children: Next compile
  // workers, esbuild, etc.) in one shot. That's the only reliable way to catch
  // every descendant a port-based kill would miss. We deliberately don't
  // `exec` the dev command — exec'ing would replace the supervisor shell and
  // break the relaunch loop. `& disown` returns the outer shell immediately
  // while the dev tree keeps running.
  const devInner = shellQuote(
    `export ${LOG_ENV}; while true; do ${dev} >> ${SANDBOX_LOG_PATH} 2>&1; sleep 1; done`
  )
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p /tmp/screenplay; ` +
        `printf %s ${devHeader} >> ${SANDBOX_LOG_PATH} 2>/dev/null; ` +
        `setsid sh -c ${devInner} </dev/null >/dev/null 2>&1 & ` +
        `echo $! > ${PIDFILE_DEV}; ` +
        `disown`,
    ],
    detached: true,
    // The port contract rides the dev command's environment, after the user's
    // repo env so it can't be shadowed: the dev script forwards
    // `$SCREENPLAY_PORT` (PORT is set too for frameworks that honor it
    // natively). Identity on the hosted backend, the allocated host port on the
    // local one.
    env: {
      ...(env ?? {}),
      SCREENPLAY_PORT: String(devPort),
      PORT: String(devPort),
    },
  })

  // Restart-on-crash wrapper so a proxy bug doesn't permanently dark the
  // iframe. Same setsid trick as above so the stop path can take down the
  // wrapper shell and any node child it spawned by killing the group.
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `setsid sh -c 'while true; do node /tmp/screenplay/proxy.mjs; sleep 1; done' </dev/null >/dev/null 2>&1 & ` +
        `echo $! > ${PIDFILE_PROXY}; ` +
        `disown`,
    ],
    detached: true,
    // Resolved, not logical: the proxy must bind the port the preview URL
    // (`domain`, which maps identically) advertises, and upstream to the port
    // the dev server was told to bind.
    env: {
      SCREENPLAY_UPSTREAM_PORT: String(devPort),
      SCREENPLAY_LISTEN_PORT: String(proxyPort),
    },
  })

  return sandbox.domain(port + PROXY_PORT_OFFSET)
}
