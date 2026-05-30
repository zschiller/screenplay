"use server"

import { SANDBOX_LOG_PATH, TERMINAL_PORT } from "@/lib/sandbox/provision-internals"
import { runSandboxAction, step } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { SandboxInstance } from "@/lib/sandbox/types"

// Pin a known-good static ttyd build (the spike validated 1.7.7's prebuilt
// x86_64 binary in the @vercel/sandbox image). The binary lives under
// /tmp/screenplay because sandbox commands run as the unprivileged
// `vercel-sandbox` user, which can write there without sudo.
const TTYD_VERSION = "1.7.7"
const TTYD_BIN = "/tmp/screenplay/ttyd"
const TTYD_URL = `https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64`
// Pidfile for the daemon. Written under `setsid` so the recorded PID equals the
// process-group leader, and read back by the liveness probe to decide whether a
// launch is needed.
const TTYD_PIDFILE = "/tmp/screenplay/terminal.pid"

/**
 * Ensure the BYO-harness web-terminal daemon is running inside the sandbox on
 * its forwarded port and return the URL it's reachable at.
 *
 * Idempotent: if a daemon is already live (its pidfile names a running
 * process), the existing daemon is reused rather than a duplicate launched, so
 * repeated calls — e.g. a collaborator opening a second terminal tab — all
 * resolve to the same URL. Uses only the existing sandbox contract: a forwarded
 * port (`domain`) plus detached `runCommand`; no PTY is added to the instance.
 *
 * Rides the `get`-based runner, so any failure (a download error, the provider
 * rejecting the resolve) crosses the server-action boundary as a redacted
 * error string rather than a thrown exception that could spill a token.
 */
export async function ensureTerminal(
  sandboxName: string,
): Promise<SandboxActionResult<{ url: string }>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    await ensureTtydInstalled(sandbox)
    if (!(await isTerminalRunning(sandbox))) {
      await launchTerminal(sandbox)
    }
    return { url: sandbox.domain(TERMINAL_PORT) }
  })
}

/**
 * Fetch the static ttyd binary if it isn't already on disk, then mark it
 * executable. Idempotent — a present binary short-circuits the download — so
 * it's safe to call on every `ensureTerminal`. A download failure exits
 * non-zero, which `step` turns into a redacted failure result.
 */
async function ensureTtydInstalled(sandbox: SandboxInstance): Promise<void> {
  await step(sandbox, "sh", [
    "-c",
    `mkdir -p /tmp/screenplay && ` +
      `{ [ -x ${TTYD_BIN} ] || ` +
      `{ curl -fsSL ${TTYD_URL} -o ${TTYD_BIN} && chmod +x ${TTYD_BIN}; }; }`,
  ])
}

/**
 * Liveness probe: true when the pidfile names a process that's still alive.
 * `kill -0` tests existence without signalling; the `|| echo stopped` keeps the
 * command's own exit code at 0 so the probe never trips `step`'s failure path.
 */
async function isTerminalRunning(sandbox: SandboxInstance): Promise<boolean> {
  const probe = await step(sandbox, "sh", [
    "-c",
    `kill -0 "$(cat ${TTYD_PIDFILE} 2>/dev/null)" 2>/dev/null && echo running || echo stopped`,
  ])
  return (await probe.stdout()).trim() === "running"
}

/**
 * Launch ttyd detached on the forwarded terminal port, serving a writable login
 * shell. `setsid` makes the daemon its own session leader so the recorded PID
 * is the process group; `& disown` returns the outer shell immediately while
 * the daemon keeps running. Output is tee'd to the shared sandbox log.
 */
async function launchTerminal(sandbox: SandboxInstance): Promise<void> {
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p /tmp/screenplay; ` +
        `setsid ${TTYD_BIN} --writable --port ${TERMINAL_PORT} bash -l ` +
        `</dev/null >> ${SANDBOX_LOG_PATH} 2>&1 & ` +
        `echo $! > ${TTYD_PIDFILE}; ` +
        `disown`,
    ],
    detached: true,
  })
}
