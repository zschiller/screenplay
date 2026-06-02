"use server"

import { TERMINAL_PORT } from "@/lib/sandbox/provision-internals"
import { runSandboxAction, step } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { SandboxInstance } from "@/lib/sandbox/types"
import { tmuxSessionName } from "@/lib/terminal/session"

// Pin a known-good static ttyd build (the spike validated 1.7.7's prebuilt
// binaries in the @vercel/sandbox image). The binary lives under
// /tmp/screenplay because sandbox commands run as the unprivileged
// `vercel-sandbox` user, which can write there without sudo.
const TTYD_VERSION = "1.7.7"
const TTYD_BIN = "/tmp/screenplay/ttyd"

// ttyd publishes one static binary per architecture, each asset named
// `ttyd.<machine>` where <machine> is the `uname -m` value. Map the sandbox's
// reported architecture to its asset rather than hardcoding x86_64, which
// silently baked the current Vercel image's arch into the seam (#268). An
// unknown arch is a loud failure, not a silent x86_64 fallback.
const TTYD_ASSET_BY_ARCH: Record<string, string> = {
  x86_64: "ttyd.x86_64",
  aarch64: "ttyd.aarch64",
}

function ttydUrl(arch: string): string {
  const asset = TTYD_ASSET_BY_ARCH[arch]
  if (!asset) {
    throw new Error(`unsupported sandbox architecture for ttyd: ${arch || "unknown"}`)
  }
  return `https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/${asset}`
}
// Pidfile for the daemon. Written under `setsid` so the recorded PID equals the
// process-group leader, and read back by the liveness probe to decide whether a
// launch is needed.
const TTYD_PIDFILE = "/tmp/screenplay/terminal.pid"

// The terminal daemon's own stdout/stderr (ttyd's connection/diagnostic chatter)
// goes here rather than the shared sandbox log. The logs tab streams
// `SANDBOX_LOG_PATH`, and ttyd's daemon logging isn't sandbox output the operator
// wants to read there — the terminal's real content is the PTY served over the
// WebSocket, never this stream. Kept as a file (not /dev/null) so it's still
// available for debugging.
const TERMINAL_LOG_PATH = "/tmp/screenplay/terminal.log"

// Pin a known-good static `tmux` build. The base @vercel/sandbox image ships
// NO `tmux` (confirmed by spike #255 and re-confirmed on a live sandbox — see
// ADR 0002's 2026-06-01 addendum, which also records that `new`/`attach`/`kill`
// run against this pin), so the reattach UX must bundle one the same way it
// bundles ttyd.
// tmux/tmux-builds publishes musl-static release tarballs per architecture,
// named tmux-<ver>-linux-<arch>; each archive is flat (a single `tmux` binary
// at its root). Lives under /tmp/screenplay alongside ttyd because that's where
// the unprivileged `vercel-sandbox` user can write without sudo.
const TMUX_VERSION = "3.6b"
const TMUX_BIN = "/tmp/screenplay/tmux"
const TMUX_TARBALL = "/tmp/screenplay/tmux.tar.gz"
// Per-server tmux config, loaded via `-f`. `status off` hides tmux's green
// bottom status bar: this is a single-session-per-tab web terminal embedded in
// our own chrome, so the bar's window list / clock add nothing and just eat a
// row. Kept as a config file (not inline `set` commands) because ttyd appends
// the session name as the final argv, leaving no room for a `\;`-chained command
// after `new`.
const TMUX_CONF = "/tmp/screenplay/tmux.conf"

// Map the sandbox's `uname -m` machine name to tmux-builds' own arch token.
// Unlike ttyd (whose assets ARE the `uname -m` names), tmux-builds calls the
// arm asset `arm64`, not `aarch64` — so this is a translation, not an identity.
// Keep both fetches architecture-aware rather than baking in x86_64 (#268).
const TMUX_ASSET_ARCH_BY_MACHINE: Record<string, string> = {
  x86_64: "x86_64",
  aarch64: "arm64",
}

function tmuxUrl(arch: string): string {
  const assetArch = TMUX_ASSET_ARCH_BY_MACHINE[arch]
  if (!assetArch) {
    throw new Error(`unsupported sandbox architecture for tmux: ${arch || "unknown"}`)
  }
  return `https://github.com/tmux/tmux-builds/releases/download/v${TMUX_VERSION}/tmux-${TMUX_VERSION}-linux-${assetArch}.tar.gz`
}

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
    // Detect the architecture once and key both binary fetches off it, so the
    // terminal stops assuming the x86_64 Vercel image (#268).
    const arch = await detectArch(sandbox)
    await ensureTtydInstalled(sandbox, arch)
    await ensureTmuxInstalled(sandbox, arch)
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
 * Detect the sandbox CPU architecture via `uname -m` (e.g. "x86_64",
 * "aarch64"). Both binary fetches key their release asset off this so the
 * terminal stops assuming the x86_64 Vercel image (#268).
 */
async function detectArch(sandbox: SandboxInstance): Promise<string> {
  const probe = await step(sandbox, "sh", ["-c", "uname -m"])
  return (await probe.stdout()).trim()
}

/**
 * Fetch the static ttyd binary if it isn't already on disk, then mark it
 * executable. Downloads the release asset matching the detected `arch` rather
 * than assuming x86_64 (#268). Idempotent — a present binary short-circuits the
 * download — so it's safe to call on every `ensureTerminal`. A download failure
 * exits non-zero, which `step` turns into a redacted failure result.
 */
async function ensureTtydInstalled(sandbox: SandboxInstance, arch: string): Promise<void> {
  const url = ttydUrl(arch)
  await step(sandbox, "sh", [
    "-c",
    `mkdir -p /tmp/screenplay && ` +
      `{ [ -x ${TTYD_BIN} ] || ` +
      `{ curl -fsSL ${url} -o ${TTYD_BIN} && chmod +x ${TTYD_BIN}; }; }`,
  ])
}

/**
 * Fetch the static `tmux` binary if it isn't already on disk, then mark it
 * executable. Mirrors {@link ensureTtydInstalled} — the base image has no
 * `tmux` — but the asset is a tarball, so we download the one matching the
 * detected `arch`, extract the single `tmux` member into /tmp/screenplay, and
 * clean up the archive. Idempotent: a present binary short-circuits the whole
 * pipeline, so it's safe on every `ensureTerminal`. Any failure exits non-zero,
 * which `step` turns into a redacted failure result.
 */
async function ensureTmuxInstalled(sandbox: SandboxInstance, arch: string): Promise<void> {
  const url = tmuxUrl(arch)
  await step(sandbox, "sh", [
    "-c",
    `mkdir -p /tmp/screenplay && ` +
      `{ [ -x ${TMUX_BIN} ] || ` +
      `{ curl -fsSL ${url} -o ${TMUX_TARBALL} && ` +
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
 * (attach-or-create); `--url-arg` lets each client append argv as `?arg=`s,
 * which ttyd forwards in order: first the session name (`screenplay-<tabId>`),
 * then — for a tab launching into a harness — the resolved launch command
 * (`sh -c '<harness>; exec $SHELL'`, #285). So a reload reattaches to the same
 * session (running harness intact; `tmux new -A` ignores the command on
 * attach), a rebuilt sandbox relaunches the harness on create, and two tabs
 * against one Branch get isolated sessions instead of colliding on a single PTY
 * (#259). The harness key → launch argv resolution lives server-side in
 * `/api/terminal/url`; this daemon stays harness-agnostic.
 *
 * `setsid` makes the daemon its own session leader so the recorded PID is the
 * process group; `& disown` returns the outer shell immediately while the
 * daemon keeps running. The daemon's output goes to its own
 * {@link TERMINAL_LOG_PATH}, not the shared sandbox log, so ttyd's connection
 * chatter never shows up in the logs tab.
 *
 * `tmux -u` forces UTF-8 output regardless of the sandbox's detected locale. The
 * base @vercel/sandbox image leaves `LANG`/`LC_*` unset, so tmux would otherwise
 * decide the terminal isn't UTF-8 and fall back to VT100 ACS line-drawing —
 * which renders Claude Code's Unicode box-drawing/rounded-corner glyphs as
 * literal junk (`qqqq`, `lqk`, mojibake). `-u` is the documented override.
 *
 * `-f ${TMUX_CONF}` loads a one-line config that hides the bottom status bar
 * (see {@link TMUX_CONF}). Both flags precede `new` because they're server/global
 * options; the session name lands last as ttyd's appended url-arg.
 */
async function launchTerminal(sandbox: SandboxInstance): Promise<void> {
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p /tmp/screenplay; ` +
        `printf 'set -g status off\\n' > ${TMUX_CONF}; ` +
        `setsid ${TTYD_BIN} --writable --url-arg --port ${TERMINAL_PORT} ` +
        `${TMUX_BIN} -u -f ${TMUX_CONF} new -A -s ` +
        `</dev/null >> ${TERMINAL_LOG_PATH} 2>&1 & ` +
        `echo $! > ${TTYD_PIDFILE}; ` +
        `disown`,
    ],
    detached: true,
  })
}
