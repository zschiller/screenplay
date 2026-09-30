/**
 * Whether a terminal tab is running something, so closing it can ask first
 * when the close would kill a process (a Claude Code or Codex session, a dev
 * server) and close at once when the tab is an idle shell.
 *
 * Pure: the server reads a process table (Linux `/proc/<pid>/stat` lines in a
 * sandbox, `ps` output on the desktop) and the pid at the root of the tab's
 * PTY, and this module decides from those. A harness tab's root is
 * `sh -c '<harness>; exec $SHELL'`, so the harness shows up as a child of a
 * shell while it runs and the tree collapses to a lone shell once it exits;
 * the rule is therefore "anything in the tree that isn't a shell".
 */

export interface ProcessRow {
  pid: number
  ppid: number
  /** The process name, as `comm` reports it (basename, no args). */
  name: string
}

/** Names that are a shell waiting at a prompt, not work. */
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "mksh",
  "tcsh",
  "csh",
  "nu",
  "login",
])

/** `-zsh` (a login shell) and `/bin/zsh` both read as `zsh`. */
function baseName(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1)
  return base.startsWith("-") ? base.slice(1) : base
}

export function isShell(name: string): boolean {
  return SHELLS.has(baseName(name))
}

/**
 * Rows from concatenated `/proc/<pid>/stat` lines: `pid (comm) state ppid …`.
 * `comm` may itself hold spaces or parentheses, so it runs to the last `)`.
 */
export function parseProcStat(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split("\n")) {
    const match = /^(\d+) \((.*)\) \S+ (\d+)/.exec(line)
    if (match) {
      rows.push({
        pid: Number(match[1]),
        name: match[2]!,
        ppid: Number(match[3]),
      })
    }
  }
  return rows
}

/** Rows from `ps -A -o pid=,ppid=,comm=`. */
export function parsePs(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (match) {
      rows.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        name: baseName(match[3]!),
      })
    }
  }
  return rows
}

/**
 * The first process in `rootPid`'s tree that isn't a shell, nearest the root
 * first (so a harness reads as `claude`, not one of its workers), or `null`
 * when the tree is only shells. A root missing from the table (the session
 * already ended) is idle.
 */
export function runningCommand(
  rows: ProcessRow[],
  rootPid: number
): string | null {
  const children = new Map<number, ProcessRow[]>()
  let root: ProcessRow | undefined
  for (const row of rows) {
    if (row.pid === rootPid) root = row
    const siblings = children.get(row.ppid)
    if (siblings) siblings.push(row)
    else children.set(row.ppid, [row])
  }
  if (!root) return null
  const queue = [root]
  const seen = new Set<number>()
  for (let row = queue.shift(); row; row = queue.shift()) {
    if (seen.has(row.pid)) continue
    seen.add(row.pid)
    if (!isShell(row.name)) return baseName(row.name)
    queue.push(...(children.get(row.pid) ?? []))
  }
  return null
}
