#!/usr/bin/env node
// PROTOTYPE (#1384 Sandbox sizing), not for main. Runs inside the stream Sandbox next to server.mjs.
// Stands in for the agent editing the Workspace's app: every --interval ms it changes apps/homepage's
// page (new text and a new Tailwind arbitrary class, so both the module graph and the CSS rebuild),
// then times GET / on the Next.js dev server until the new marker is in the HTML. That's edit →
// compiled page, what a frame showing the app waits for. --tsc also runs `tsc --noEmit` in a loop,
// standing in for the agent's own checks.
//
//   node edit-loop.mjs --dir ~/ws/apps/homepage [--port 3001] [--interval 4000] [--seconds 40] [--tsc]
import { readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { join } from "node:path"

const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const DIR = arg("dir", "/vercel/sandbox/ws/apps/homepage")
const PORT = Number(arg("port", 3001))
const INTERVAL = Number(arg("interval", 4000))
const SECONDS = Number(arg("seconds", 40))
const TSC = process.argv.includes("--tsc")
const file = join(DIR, "app/page.tsx")
const original = readFileSync(file, "utf8").replace(/\n\s*<span data-m=.*\/>/, "")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let tsc = null, tscRuns = []
const runTsc = () => {
  const t0 = Date.now()
  tsc = spawn("npx", ["tsc", "--noEmit", "-p", "."], { cwd: DIR, stdio: "ignore" })
  tsc.on("exit", () => { tscRuns.push(Date.now() - t0); if (!done) runTsc() })
}
let done = false
if (TSC) runTsc()

const results = []
const end = Date.now() + SECONDS * 1000
for (let n = 0; Date.now() < end; n++) {
  const mark = `m${Date.now()}`
  writeFileSync(file, original.replace("<Footer />", `<Footer />\n      <span data-m="${mark}" className="hidden w-[${(n % 900) + 100}px]" />`))
  const t0 = Date.now()
  let ms = null
  while (Date.now() - t0 < 30000) {
    try { if ((await (await fetch(`http://127.0.0.1:${PORT}/`)).text()).includes(mark)) { ms = Date.now() - t0; break } } catch {}
    await sleep(50)
  }
  results.push(ms)
  await sleep(Math.max(0, INTERVAL - (Date.now() - t0)))
}
done = true
tsc?.kill("SIGKILL")
writeFileSync(file, original)
const ok = results.filter((x) => x != null).sort((a, b) => a - b)
const q = (f) => ok.length ? ok[Math.min(ok.length - 1, Math.floor(f * ok.length))] : null
console.log(JSON.stringify({ edits: results.length, failed: results.length - ok.length, compileMs: { p50: q(0.5), p90: q(0.9), max: q(1) }, tscMs: tscRuns }))
process.exit(0)
