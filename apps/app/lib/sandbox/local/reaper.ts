import { execSync } from "node:child_process"
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
  /**
   * Process-table reader: `pid ppid pgid` per line. Defaults to a synchronous
   * `ps -A`; tests inject a fixed table. May throw — the sweep then falls back
   * to the plain group kill.
   */
  listProcesses?: () => string
}

/** One `ps` row: enough ancestry to walk a tree and kill by group. */
interface ProcessRow {
  pid: number
  ppid: number
  pgid: number
}

/**
 * Snapshot the live process table. Synchronous on purpose (the exit hook may
 * be the caller). Repeated `-o` flags (not the comma form) so the same
 * invocation parses on both BSD/macOS and procps ps.
 */
function readProcessTable(): string {
  return execSync("ps -A -o pid= -o ppid= -o pgid=", { encoding: "utf8" })
}

function parseProcessTable(raw: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of raw.split("\n")) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
    if (
      Number.isInteger(pid) &&
      Number.isInteger(ppid) &&
      Number.isInteger(pgid)
    ) {
      rows.push({ pid, ppid, pgid })
    }
  }
  return rows
}

/**
 * The transitive descendants of `root` in a process-table snapshot, plus every
 * process group they belong to (as negative pids, ready for `kill`). This is
 * what catches the dev server itself: the supervised `portless run` spawns the
 * dev script with `detached: true`, so the real dev tree (npm → next → compile
 * workers) sits in its own process group that the recorded supervisor group
 * doesn't contain — and SIGKILL means portless's own kill-tree cleanup never
 * runs. Guards 0/1 so a corrupt row can never widen the kill to `kill(-1)`.
 */
function descendantKillTargets(rows: ProcessRow[], root: number): number[] {
  const marked = new Set<number>([root])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (!marked.has(row.pid) && marked.has(row.ppid)) {
        marked.add(row.pid)
        changed = true
      }
    }
  }
  const targets = new Set<number>()
  for (const row of rows) {
    if (!marked.has(row.pid) || row.pid === root) continue
    if (row.pid > 1) targets.add(row.pid)
    if (row.pgid > 1) targets.add(-row.pgid)
  }
  return [...targets]
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

  // Snapshot the process table once, before any kill, while the parent links
  // are still intact — the descendant walk below needs them. Best-effort: with
  // no table the sweep degrades to the plain group kill.
  let processRows: ProcessRow[] = []
  try {
    processRows = parseProcessTable((deps.listProcesses ?? readProcessTable)())
  } catch {
    // ps unavailable/failed — group kill only.
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
        // The recorded pid is a session leader, so pid === pgid and the
        // negative form takes down everything still in its group (supervisor
        // loop, proxy node). The plain kill is the fallback for the rare
        // non-leader pid — same two-step as stopDevAndProxy. The recorded
        // group dies first so the supervisor's respawn loop can't race the
        // descendant sweep below.
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
        // Then every descendant and its process group — the dev tree that
        // portless re-detached out of the recorded group (see
        // {@link descendantKillTargets}).
        for (const target of descendantKillTargets(processRows, pid)) {
          try {
            kill(target, "SIGKILL")
          } catch {
            // Already gone.
          }
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
