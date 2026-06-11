import fs from "node:fs"
import path from "node:path"

/**
 * Reap the local backend's detached sandbox process groups.
 *
 * On the desktop (local) backend every dev server, bridge proxy, and terminal
 * session is a detached, `setsid`'d process group **on the host**, recorded by
 * pidfile under `/tmp/screenplay/<sandbox>/*.pid` (see provision-internals /
 * terminal.ts). Detachment is what lets them survive request lifecycles — but
 * it also means nothing takes them down when the sidecar goes away: a straight
 * SIGKILL of the sidecar (the old Tauri quit path, or a crash) orphans every
 * one of them until reboot.
 *
 * This module closes that hole from both ends:
 *
 *  - **On boot**, a sweep kills anything a previous run left behind — the only
 *    possible cleanup after a force-killed sidecar, which by definition never
 *    ran its own exit hook. At boot no sandbox process is legitimately live
 *    (this process owns every launch, and `launchDevAndProxy` group-kills via
 *    the same pidfiles before relaunching), so everything recorded is stale.
 *  - **On exit**, the same sweep runs from a `process.on("exit")` hook, so a
 *    clean quit (Tauri sends SIGTERM, see sidecar.rs) or a parent-watch
 *    self-exit takes the whole fleet down with the sidecar.
 *
 * Pid reuse is the accepted residual risk, same as `stopDevAndProxy`'s: a
 * recorded pid could in principle now belong to an unrelated process. /tmp is
 * cleared on reboot (macOS/Linux), so pidfiles never survive across boots.
 */

/** Mirrors SCREENPLAY_DIR in provision-internals (host-side on this backend). */
const STATE_ROOT = "/tmp/screenplay"

export interface ReaperDeps {
  /** State root to sweep. Defaults to {@link STATE_ROOT}; tests use a temp dir. */
  root?: string
  /** Signal sender. Defaults to `process.kill`; tests record instead. */
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

/**
 * Kill every process group recorded by a `*.pid` file under the state root and
 * remove the files. Synchronous on purpose: the exit hook is the last code that
 * runs in the process, and `"exit"` listeners must not await. Best-effort
 * throughout — a vanished dir, an unreadable file, or an already-dead pid is
 * skipped, never thrown.
 */
export function reapLocalSandboxProcessesSync(deps: ReaperDeps = {}): void {
  const root = deps.root ?? STATE_ROOT
  const kill = deps.kill ?? ((pid, sig) => process.kill(pid, sig))

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return // no state root — nothing was ever launched
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    let files: string[]
    try {
      files = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith(".pid")) continue
      const pidfile = path.join(dir, file)
      let pid = NaN
      try {
        pid = Number.parseInt(fs.readFileSync(pidfile, "utf8").trim(), 10)
      } catch {
        // Unreadable — still remove it below so it can't confuse a later sweep.
      }
      // Guard the low pids: a corrupt pidfile must never turn into a
      // `kill(-1)` (every process we can signal) or a signal to init.
      if (Number.isInteger(pid) && pid > 1) {
        // The recorded pid is a setsid session leader, so pid === pgid and the
        // negative form takes down the whole tree (supervisor loop, dev server,
        // its compile workers). The plain kill is the fallback for the rare
        // non-leader pid — same two-step as stopDevAndProxy.
        try {
          kill(-pid, "SIGKILL")
        } catch {
          // Already gone.
        }
        try {
          kill(pid, "SIGKILL")
        } catch {
          // Already gone.
        }
      }
      try {
        fs.rmSync(pidfile, { force: true })
      } catch {
        // Best-effort: a leftover pidfile is reclaimed by the next sweep.
      }
    }
  }
}

/** One installation per process; keyed on the process object so tests can inject. */
const INSTALLED = Symbol.for("screenplay.localSandboxReaper")

/**
 * Install the reaper into this process: sweep what a previous run left behind,
 * register the exit-hook sweep, and make SIGTERM/SIGINT actually exit (Node's
 * default termination on those signals skips `"exit"` listeners; routing them
 * through `process.exit` is what guarantees the sweep runs on a clean quit).
 * Idempotent. Desktop-only by construction — the caller (instrumentation.ts)
 * gates on `isLocalSandboxBackend()`.
 */
export function installLocalSandboxReaper(
  deps: ReaperDeps & { proc?: NodeJS.Process } = {}
): void {
  const proc = deps.proc ?? process
  const marked = proc as NodeJS.Process & { [INSTALLED]?: boolean }
  if (marked[INSTALLED]) return
  marked[INSTALLED] = true

  reapLocalSandboxProcessesSync(deps)
  proc.on("exit", () => reapLocalSandboxProcessesSync(deps))
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    proc.on(signal, () => proc.exit(0))
  }
}
