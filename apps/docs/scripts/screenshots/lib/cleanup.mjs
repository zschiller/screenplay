// Stop the workspace processes (dev servers, bridge proxies, respawn loops)
// that the local build started for *this* tool's run. The app tracks them in
// pidfiles under /tmp/screenplay/<sandbox>/; a sandbox is ours when a process
// in its tree runs from WORK_DIR (its worktree lives there). Other Screenplay
// instances on the machine are left alone.
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { WORK_DIR } from "./env.mjs"

const STATE_ROOT = "/tmp/screenplay"

function processTable() {
  const rows = []
  for (const line of execSync("ps -A -o pid= -o ppid= -o pgid= -o args=", { encoding: "utf8" }).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
    if (m) rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], args: m[4] })
  }
  return rows
}

function tree(rows, root) {
  const marked = new Set([root])
  for (let changed = true; changed; ) {
    changed = false
    for (const r of rows)
      if (!marked.has(r.pid) && marked.has(r.ppid)) (marked.add(r.pid), (changed = true))
  }
  return rows.filter((r) => marked.has(r.pid))
}

const kill = (target) => {
  try {
    process.kill(target, "SIGKILL")
  } catch {}
}

export function killWorkspaceProcesses() {
  if (!fs.existsSync(STATE_ROOT)) return 0
  const rows = processTable()
  let killed = 0
  for (const entry of fs.readdirSync(STATE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(STATE_ROOT, entry.name)
    const pids = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".pid"))
      .map((f) => Number.parseInt(fs.readFileSync(path.join(dir, f), "utf8"), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 1)
    const members = pids.flatMap((pid) => tree(rows, pid))
    if (!members.some((r) => r.args.includes(WORK_DIR))) continue
    for (const r of members) {
      if (r.pgid > 1) kill(-r.pgid)
      kill(r.pid)
    }
    killed++
  }
  return killed
}
