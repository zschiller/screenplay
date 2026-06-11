import "server-only"

import path from "node:path"

import type { SandboxInstance } from "@/lib/sandbox"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"

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

// Shared host dir for screenplay tooling (the ttyd/tmux binaries, the bridge
// proxy scripts) — content-identical across Sandboxes and deliberately shared
// on the local backend's single host filesystem.
const SCREENPLAY_DIR = "/tmp/screenplay"

/**
 * Per-Sandbox runtime-state directory under {@link SCREENPLAY_DIR}. On the
 * hosted backend each Sandbox is its own microVM, so any fixed path is already
 * unique; on the local (worktree) backend every Sandbox shares the host
 * filesystem, so per-Sandbox state — the dev/terminal logs and the
 * dev/proxy/terminal pidfiles — MUST be namespaced by Sandbox name or it
 * collides across Branches of the same Repo: one Branch's dev-server output
 * streaming into another's Logs panel, one Branch's stop killing another's dev
 * server through a shared pidfile. Sandbox names are `sp-<nanoid>`
 * (alphanumeric/`-`/`_`), always path-safe — no traversal, no slashes from refs.
 */
export function sandboxStateDir(name: string): string {
  return `${SCREENPLAY_DIR}/${name}`
}

/** Dev-server + provisioning output the Logs panel tails. Per-Sandbox. */
export function sandboxLogPath(name: string): string {
  return `${sandboxStateDir(name)}/sandbox.log`
}

// Pidfiles for the dev server and proxy. Both are launched under
// {@link sessionLeader} so their PID equals their PGID — the stop path uses
// these to SIGKILL the whole process group in one shot, catching every child
// that a port-based kill would otherwise miss (Next compile workers, esbuild,
// the proxy respawn loop). Per-Sandbox (see {@link sandboxStateDir}).
const devPidPath = (name: string) => `${sandboxStateDir(name)}/dev.pid`
const proxyPidPath = (name: string) => `${sandboxStateDir(name)}/proxy.pid`

/**
 * Command prefix that runs its argv as a new session (hence process-group)
 * leader, so the PID we record in a pidfile equals its PGID and the stop path's
 * `kill -KILL -<pid>` tears down the whole tree in one shot.
 *
 * Linux ships `setsid`, but macOS — where the local backend runs its commands
 * directly on the host — does not. A literal `setsid` there dies with "command
 * not found", swallowed by each launch's `>/dev/null 2>&1`, so the dev server,
 * bridge proxy, and terminal daemon never start: the Logs panel shows only the
 * `$ <script>` header and nothing else. On macOS we shim it with Perl's
 * `POSIX::setsid` (always present at /usr/bin/perl) — it opens a new session
 * then `exec`s the real argv, an identical net effect. The hosted backend
 * (always a Linux VM) and a Linux local host keep the native `setsid`.
 */
export function sessionLeader(): string {
  return isLocalSandboxBackend() && process.platform === "darwin"
    ? `perl -MPOSIX -e 'POSIX::setsid(); exec(@ARGV) or die "exec: $!"' --`
    : "setsid"
}

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
 * Named, user-visible failure for a dev server that never bound its assigned
 * port: the bridge proxy is up and reachable, but nothing listened on the
 * resolved dev port past the probe window. Raised only where logical ≠ bound
 * (the local backend, where the dev script runs under portless) — on an
 * identity backend a dev server's default port IS the assigned port, so this
 * failure mode can't exist there. Covers both portless-era causes: a dev
 * script that ignores the `$PORT` portless assigns, and portless itself
 * failing to launch (its proxy daemon isn't running). Distinct from generic
 * dev-server-crash failures so the user is told what to fix instead of
 * staring at a dead iframe.
 */
export class DevServerPortIgnoredError extends Error {
  constructor() {
    super(
      "The dev server never listened on its assigned port. The desktop app " +
        "runs your dev script under portless (https://portless.sh), which " +
        "hands it the port as $PORT — frameworks like Next.js pick it up " +
        'automatically; others need it forwarded, e.g. "vite --port $PORT ' +
        '--strictPort". Check the Logs panel: if portless reported its proxy ' +
        "isn't running, run `npx portless proxy start` once in a terminal. " +
        "Then fix the dev script in the Project settings if needed and " +
        "restart the dev server."
    )
    this.name = "DevServerPortIgnoredError"
  }
}

/**
 * Where the portless CLI lives — a regular dependency of the app, resolved
 * from cwd like the sandbox-bridge files (`lib/sandbox-bridge/index.ts`):
 * both `next dev` and the desktop sidecar run with cwd at the app root, and
 * `build-sidecar.mjs` folds the package into the standalone tree at this
 * path. Spawned as `node <cli.js>` (it has no runtime dependencies), so the
 * host needs no global portless install.
 */
function portlessCliPath(): string {
  return path.join(process.cwd(), "node_modules", "portless", "dist", "cli.js")
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Run a command in the sandbox with stdout+stderr tee'd to this Sandbox's log
 * file so the Logs panel can surface the full startup output (npm install, git
 * pull, dev server, etc.). The command's exit code is preserved. Callers that
 * need stdout content should still use `sandbox.runCommand` directly — this
 * helper discards buffered output.
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
  const logPath = sandboxLogPath(sandbox.name)
  const sh =
    `mkdir -p ${sandboxStateDir(sandbox.name)}; ` +
    `printf %s ${header} >> ${logPath} 2>/dev/null; ` +
    `${LOG_ENV} ${quotedCmd} >> ${logPath} 2>&1; ` +
    `printf '[exit %s]\\n' $? >> ${logPath} 2>/dev/null`
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
 * Both were started under {@link sessionLeader}, so the PID recorded in each
 * pidfile is its own process-group leader, and `kill -KILL -<pid>` takes down
 * the supervisor loop and everything still in its group in one shot.
 *
 * **The group kill alone is not enough on the local backend.** The supervised
 * command there is `portless run`, and portless spawns the actual dev script
 * with `detached: true` (its spawnChildProcess, non-Windows) — so the real dev
 * server (`npm run dev` → next → compile workers) lives in a *new* process
 * group the pidfile knows nothing about. And because we SIGKILL, portless's
 * own SIGTERM kill-tree cleanup never runs. So before killing, snapshot the
 * process table (`ps`), walk the recorded pid's transitive descendants, and
 * kill every descendant's process group too. The snapshot is taken while the
 * parent links are still intact; the recorded group dies first so the
 * supervisor's respawn loop can't race the sweep. On the hosted backend the
 * dev script runs undetached, so the walk finds nothing new and the group
 * kill carries the day as before.
 *
 * The plain `kill -KILL <pid>` is a fallback for the rare case a recorded PID
 * isn't a group leader. Stale or missing pidfiles (a fresh VM, a snapshot
 * whose recorded PIDs don't exist in the new process namespace) are harmless:
 * the kills no-op and we remove the files. A pidfile holding `1`, `0`, or
 * garbage is never signalled (a corrupt file must not become `kill -1`).
 * Always succeeds — a relaunch must not be blocked by a failed cleanup.
 *
 * This is what makes {@link launchDevAndProxy} idempotent: without it, a second
 * launch into a still-live VM (a reconnect whose preview probe transiently
 * failed, racing reconnects, a restart over a running server) stacks a second
 * supervisor on top of the first. The new dev server then loses the port and
 * can't acquire `.next/dev/lock`, so it exit-1s and the supervisor respawns it
 * every second forever — and the overwritten pidfile orphans the original.
 */
export async function stopDevAndProxy(sandbox: SandboxInstance): Promise<void> {
  const devPid = devPidPath(sandbox.name)
  const proxyPid = proxyPidPath(sandbox.name)
  // Transitive closure over the ps snapshot: mark the root, keep marking any
  // process whose parent is marked, then print every marked pid and its pgid
  // (guarding 0/1 so a corrupt row can't widen the kill).
  const descendants =
    `awk -v r="$p" '` +
    `{ pid[NR]=$1; pp[NR]=$2; pg[NR]=$3 } ` +
    `END { m[r]=1; do { c=0; for (i=1;i<=NR;i++) if (!m[pid[i]] && m[pp[i]]) { m[pid[i]]=1; c=1 } } while (c); ` +
    `for (i=1;i<=NR;i++) if (m[pid[i]] && pid[i]>1) { print pid[i]; if (pg[i]>1) print pg[i] } }'`
  const kill =
    `tab=$(ps -A -o pid= -o ppid= -o pgid= 2>/dev/null); ` +
    `for f in ${devPid} ${proxyPid}; do ` +
    `p=$(cat "$f" 2>/dev/null); ` +
    `[ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null || continue; ` +
    `kill -KILL "-$p" 2>/dev/null; kill -KILL "$p" 2>/dev/null; ` +
    `for t in $(printf '%s\\n' "$tab" | ${descendants}); do ` +
    `kill -KILL "-$t" 2>/dev/null; kill -KILL "$t" 2>/dev/null; ` +
    `done; ` +
    `done; ` +
    `rm -f ${devPid} ${proxyPid} 2>/dev/null; true`
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
 * the host's network). How the resolved value reaches the dev server differs
 * by backend:
 *
 *  - **Hosted**: handed to the dev command as `$SCREENPLAY_PORT` (and
 *    `$PORT`) — the dev-script contract: the Repo's configured dev script
 *    forwards it (e.g. `next dev --port $SCREENPLAY_PORT`).
 *  - **Local (desktop)**: the dev script runs under **portless**
 *    (https://portless.sh) with `--app-port <resolved>` — portless owns
 *    delivering the port (it sets `$PORT`, the convention frameworks already
 *    honor) and registers a named `.localhost` route for the dev server as a
 *    bonus (`portless list` shows it; in a Branch worktree the branch name
 *    becomes a subdomain prefix). `$SCREENPLAY_PORT` is not set here.
 *
 * Either way the proxy binds its resolved listen port and upstreams to the
 * resolved dev port, so the launch, the advertised preview URL (`domain`,
 * which maps the same way), and what's actually listening always agree.
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
  const stateDir = sandboxStateDir(sandbox.name)
  const logPath = sandboxLogPath(sandbox.name)
  const devPid = devPidPath(sandbox.name)
  const proxyPid = proxyPidPath(sandbox.name)
  const dev = devScript?.trim() || "npm run dev"
  // The local backend wraps the dev script in portless. The script stays a
  // single `sh -c` argument so its full shell semantics survive (env prefixes,
  // `&&`, pipes) — portless contributes the port (its `$PORT` is in scope when
  // the inner sh expands the script) and the route registration. `--app-port`
  // pins portless to our allocated host port: the bridge proxy below must know
  // the upstream, and the per-Sandbox allocation already guarantees
  // distinctness. No `--force`: a route left by a group-killed previous launch
  // has a dead pid and is reclaimed silently, while a *live* conflicting owner
  // (someone else's portless app with the same name) fails visibly in the log
  // instead of being SIGTERMed.
  const devCommand = isLocalSandboxBackend()
    ? `${shellQuote(process.execPath)} ${shellQuote(portlessCliPath())} run ` +
      `--app-port ${devPort} sh -c ${shellQuote(dev)}`
    : dev
  const devHeader = shellQuote(`\n$ ${dev}\n`)
  // Launch the dev server under a restart-on-crash supervisor, mirroring the
  // proxy below, so a crashed dev server comes back on its own without any
  // reload or reconnect. {@link sessionLeader} makes the supervisor the leader
  // of a new session, so the PID we record equals its PGID — the stop path uses
  // `kill -KILL -<pid>` to take down the whole process group (the supervisor
  // loop, its current dev child, and that child's own children: Next compile
  // workers, esbuild, etc.) in one shot. That's the only reliable way to catch
  // every descendant a port-based kill would miss. We deliberately don't
  // `exec` the dev command — exec'ing would replace the supervisor shell and
  // break the relaunch loop. `& disown` returns the outer shell immediately
  // while the dev tree keeps running.
  const devInner = shellQuote(
    `export ${LOG_ENV}; while true; do ${devCommand} >> ${logPath} 2>&1; sleep 1; done`
  )
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p ${stateDir}; ` +
        `printf %s ${devHeader} >> ${logPath} 2>/dev/null; ` +
        `${sessionLeader()} sh -c ${devInner} </dev/null >/dev/null 2>&1 & ` +
        `echo $! > ${devPid}; ` +
        `disown`,
    ],
    detached: true,
    // On the hosted backend the port contract rides the dev command's
    // environment, after the user's repo env so it can't be shadowed: the dev
    // script forwards `$SCREENPLAY_PORT` (PORT is set too for frameworks that
    // honor it natively). On the local backend neither is set — portless
    // injects `$PORT` into the dev script's process itself, overriding
    // anything inherited (including the desktop sidecar's own PORT).
    env: {
      ...(env ?? {}),
      ...(isLocalSandboxBackend()
        ? {}
        : { SCREENPLAY_PORT: String(devPort), PORT: String(devPort) }),
    },
  })

  // Restart-on-crash wrapper so a proxy bug doesn't permanently dark the
  // iframe. Same session-leader trick as above so the stop path can take down
  // the wrapper shell and any node child it spawned by killing the group.
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `${sessionLeader()} sh -c 'while true; do node ${SCREENPLAY_DIR}/proxy.mjs; sleep 1; done' </dev/null >/dev/null 2>&1 & ` +
        `echo $! > ${proxyPid}; ` +
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
