"use server"

import { SANDBOX_LOG_PATH, TERMINAL_PORT } from "@/lib/sandbox/provision-internals"
import { runSandboxAction, step } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { SandboxInstance } from "@/lib/sandbox/types"
import { tmuxSessionName } from "@/lib/terminal/session"

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

// Pin a known-good static `tmux` build. The base @vercel/sandbox image ships
// NO `tmux` (confirmed by spike #255 and re-confirmed on a live sandbox — see
// ADR 0002's 2026-06-01 addendum, which also records that `new`/`attach`/`kill`
// run against this pin), so the reattach UX must bundle one the same way it
// bundles ttyd.
// tmux/tmux-builds publishes musl-static x86_64 release tarballs; the archive
// is flat (a single `tmux` binary at its root). Lives under /tmp/screenplay
// alongside ttyd because that's where the unprivileged `vercel-sandbox` user
// can write without sudo.
const TMUX_VERSION = "3.6b"
const TMUX_BIN = "/tmp/screenplay/tmux"
const TMUX_TARBALL = "/tmp/screenplay/tmux.tar.gz"
const TMUX_URL = `https://github.com/tmux/tmux-builds/releases/download/v${TMUX_VERSION}/tmux-${TMUX_VERSION}-linux-x86_64.tar.gz`

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
    await ensureTmuxInstalled(sandbox)
    if (!(await isTerminalRunning(sandbox))) {
      await launchTerminal(sandbox)
    }
    return { url: sandbox.domain(TERMINAL_PORT) }
  })
}

/**
 * Kill a terminal tab's `tmux` session — its shell and any process running in
 * it (e.g. a Claude Code harness) — when the user closes the tab (#258's X,
 * extended here to terminate the running process, not just drop the tab row).
 *
 * `terminalSessionId` is the tab's id; the session name is derived server-side
 * via {@link tmuxSessionName} so a client never names the target directly. A
 * missing session (already gone, or the sandbox was rebuilt) is a no-op, not a
 * failure. Rides `runSandboxAction`, so any error crosses the server-action
 * boundary as a redacted string.
 */
export async function killTerminalSession(
  sandboxName: string,
  terminalSessionId: string,
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    const session = tmuxSessionName(terminalSessionId)
    // `|| true` keeps the exit code at 0 when the session doesn't exist, so a
    // close-after-it-already-ended never trips `step`'s failure path.
    await step(sandbox, "sh", [
      "-c",
      `${TMUX_BIN} kill-session -t ${session} 2>/dev/null || true`,
    ])
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
 * Fetch the static `tmux` binary if it isn't already on disk, then mark it
 * executable. Mirrors {@link ensureTtydInstalled} — the base image has no
 * `tmux` — but the asset is a tarball, so we download it, extract the single
 * `tmux` member into /tmp/screenplay, and clean up the archive. Idempotent: a
 * present binary short-circuits the whole pipeline, so it's safe on every
 * `ensureTerminal`. Any failure exits non-zero, which `step` turns into a
 * redacted failure result.
 */
async function ensureTmuxInstalled(sandbox: SandboxInstance): Promise<void> {
  await step(sandbox, "sh", [
    "-c",
    `mkdir -p /tmp/screenplay && ` +
      `{ [ -x ${TMUX_BIN} ] || ` +
      `{ curl -fsSL ${TMUX_URL} -o ${TMUX_TARBALL} && ` +
      `tar -xzf ${TMUX_TARBALL} -C /tmp/screenplay tmux && ` +
      `chmod +x ${TMUX_BIN} && rm -f ${TMUX_TARBALL}; }; }`,
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
 * Launch ttyd detached on the forwarded terminal port, serving a per-tab
 * persistent `tmux` session. The base command is `tmux new -A -s`
 * (attach-or-create); `--url-arg` lets each client append the session name as
 * `?arg=screenplay-<tabId>`, which ttyd passes as the final argv — so a reload
 * reattaches to the same session (running harness intact) and two tabs against
 * one Branch get isolated sessions instead of colliding on a single PTY (#259).
 *
 * `setsid` makes the daemon its own session leader so the recorded PID is the
 * process group; `& disown` returns the outer shell immediately while the
 * daemon keeps running. Output is tee'd to the shared sandbox log.
 */
async function launchTerminal(sandbox: SandboxInstance): Promise<void> {
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p /tmp/screenplay; ` +
        `setsid ${TTYD_BIN} --writable --url-arg --port ${TERMINAL_PORT} ` +
        `${TMUX_BIN} new -A -s ` +
        `</dev/null >> ${SANDBOX_LOG_PATH} 2>&1 & ` +
        `echo $! > ${TTYD_PIDFILE}; ` +
        `disown`,
    ],
    detached: true,
  })
}
