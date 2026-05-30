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

// Claude Code gates on ANTHROPIC_API_KEY being set — the value doesn't matter
// since the firewall proxy overrides the header on egress.
export const BROKERED_ANTHROPIC_ENV = { ANTHROPIC_API_KEY: "brokered" }

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
  options: { env?: Record<string, string>; label?: string } = {},
) {
  const label = options.label ?? `${cmd}${args.length ? " " + args.join(" ") : ""}`
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
export async function writeBridgeFiles(sandbox: SandboxInstance): Promise<void> {
  const { PROXY_JS, BRIDGE_JS } = await import("@/lib/sandbox-bridge")
  await sandbox.writeFiles([
    { path: "/tmp/screenplay/proxy.mjs", content: PROXY_JS },
    { path: "/tmp/screenplay/bridge.js", content: BRIDGE_JS },
  ])
}

/**
 * Launch both the user's dev server and the bridge proxy. Installs the bridge
 * files first (idempotent). Returns the preview domain pointing at the proxy
 * port (port + PROXY_PORT_OFFSET) rather than the devserver port. Throws if the
 * bridge install fails — callers running through the runner turn that into a
 * redacted failure result.
 */
export async function launchDevAndProxy(
  sandbox: SandboxInstance,
  port: number,
  devScript?: string,
  env?: Record<string, string> | null,
): Promise<string> {
  await writeBridgeFiles(sandbox)

  const dev = devScript?.trim() || "npm run dev"
  const devHeader = shellQuote(`\n$ ${dev}\n`)
  // Launch the dev server under `setsid` so it becomes the leader of a new
  // session and its PID equals its PGID. We capture that PID — the stop path
  // uses `kill -KILL -<pid>` to take down the whole process group, which is
  // the only reliable way to catch every child the dev server spawns
  // (Next compile workers, esbuild, etc.). `& disown` returns the outer
  // shell immediately while the dev tree keeps running.
  const devInner = shellQuote(
    `export ${LOG_ENV}; exec ${dev} >> ${SANDBOX_LOG_PATH} 2>&1`,
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
    ...(env ? { env } : {}),
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
    env: {
      SCREENPLAY_UPSTREAM_PORT: String(port),
      SCREENPLAY_LISTEN_PORT: String(port + PROXY_PORT_OFFSET),
    },
  })

  return sandbox.domain(port + PROXY_PORT_OFFSET)
}
