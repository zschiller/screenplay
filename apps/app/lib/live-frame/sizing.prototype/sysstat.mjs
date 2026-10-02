#!/usr/bin/env node
// PROTOTYPE (#1384), not for main. Whole-Sandbox CPU (% of all vCPUs, 100% = every vCPU busy) and
// memory in use, sampled every 500 ms for --seconds. The per-process numbers come from server.mjs /stats.
import { readFileSync } from "node:fs"
const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const SECONDS = Number(arg("seconds", 20))
const cpu = () => { const f = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number); const idle = f[3] + f[4]; return { idle, total: f.reduce((a, b) => a + b, 0) } }
const mem = () => { const m = Object.fromEntries(readFileSync("/proc/meminfo", "utf8").split("\n").filter(Boolean).map((l) => { const [k, v] = l.split(":"); return [k, parseInt(v)] })); return Math.round((m.MemTotal - m.MemAvailable) / 1024) }
const busy = [], used = []
let prev = cpu()
for (let i = 0; i < SECONDS * 2; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const c = cpu()
  busy.push(100 * (1 - (c.idle - prev.idle) / (c.total - prev.total)))
  used.push(mem())
  prev = c
}
const s = [...busy].sort((a, b) => a - b)
const q = (f) => Math.round(s[Math.min(s.length - 1, Math.floor(f * s.length))])
const total = Math.round(parseInt(readFileSync("/proc/meminfo", "utf8").match(/MemTotal:\s+(\d+)/)[1]) / 1024)
console.log(JSON.stringify({ cpuPct: { avg: Math.round(busy.reduce((a, b) => a + b, 0) / busy.length), p50: q(0.5), p90: q(0.9), max: q(1) }, memMB: { max: Math.max(...used), total } }))
