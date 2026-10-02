#!/usr/bin/env node
// PROTOTYPE (#1384 Sandbox sizing), not for main. Throwaway; see README.md.
//
// For each Sandbox size: one stream Sandbox runs the Workspace (apps/homepage's Next.js dev server)
// plus the live frame server from ../webrtc.prototype, and a second Sandbox in the same region runs
// the bench viewer (headless Chrome) against https://sb-….vercel.run, as in #1366. Each scenario
// starts 1–3 frames (still or busy page, 60 fps, unchanged frames skipped per #1368), optionally
// with the agent editing the app every few seconds (and running tsc), then records click/key to
// picture, frame gaps, compile time, whole-Sandbox CPU and memory. Results append to results.jsonl.
//
//   cd apps/app/lib/live-frame/sizing.prototype && npm i @vercel/sandbox@3.5.1
//   node run.mjs [--vcpus 2,4,8] [--frames 1,2,3] [--pages still,busy] [--loads idle,edits,tsc] [--region iad1]
// Auth: VERCEL_OIDC_TOKEN, or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID.
import { Sandbox } from "@vercel/sandbox"
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" }).trim()
const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const list = (n, f) => arg(n, f).split(",")
const VCPUS = list("vcpus", "2,4,8").map(Number)
const FRAMES = list("frames", "1,2,3").map(Number)
const PAGES = list("pages", "still,busy")
const LOADS = list("loads", "idle,edits,tsc")
const FPS = Number(arg("fps", 60))
const REGION = arg("region", "iad1")
const OUT = arg("out", join(here, "results.jsonl"))
const PROTO = join(here, "../webrtc.prototype")
const HOME = "/vercel/sandbox"
const CHROME = "/usr/bin/google-chrome"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function sh(sb, script, { sudo = false, detached = false } = {}) {
  const cmd = await sb.runCommand({ cmd: "bash", args: ["-lc", script], sudo, detached })
  if (detached) return cmd
  if (cmd.exitCode !== 0) throw new Error(`${script.slice(0, 80)}… exited ${cmd.exitCode}: ${(await cmd.stderr()).slice(-2000)}`)
  return (await cmd.stdout()).trim()
}
const lastJson = (s) => JSON.parse(s.trim().split("\n").filter((l) => l.startsWith("{")).pop())

// Browsers, X and ffmpeg: as in #1366 (Ubuntu image, Google Chrome for H.264).
const installDesktop = (sb) => sh(sb, `set -e
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb ffmpeg >/dev/null
  curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/chrome.deb >/dev/null`, { sudo: true })

// The live frame prototype, listening on 0.0.0.0 so the Sandbox proxy reaches it.
const protoFiles = () => ["server.mjs", "viewer.html", "demo.html", "bench.mjs", "package.json"].map((f) => {
  let content = readFileSync(join(PROTO, f), "utf8")
  if (f === "server.mjs") content = content.replace(`server.listen(PORT, "127.0.0.1"`, `server.listen(PORT, "0.0.0.0"`)
  return { path: `${HOME}/proto/${f}`, content: Buffer.from(content) }
})

// The Workspace's app: apps/homepage and the workspace packages it uses, plus every workspace
// package.json so the frozen lockfile still matches.
function workspaceFiles() {
  const tracked = execFileSync("git", ["ls-files", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "apps/*/package.json", "packages/*/package.json", "apps/homepage", "packages/ui", "packages/typescript-config", "packages/eslint-config"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)
  return [...new Set(tracked)].map((f) => ({ path: `${HOME}/ws/${f}`, content: readFileSync(join(repo, f)) }))
}

async function createSandbox(vcpus, ports) {
  const sb = await Sandbox.create({ resources: { vcpus }, ports, timeout: 90 * 60 * 1000, region: REGION })
  log(`sandbox ${sb.sandboxId}: ${vcpus} vCPU in ${REGION}`)
  return sb
}

async function setupViewer() {
  const sb = await createSandbox(2, [])
  await installDesktop(sb)
  await sb.writeFiles(protoFiles())
  return sb
}

async function setupStream(vcpus) {
  const sb = await createSandbox(vcpus, [4990, 3001])
  await sb.writeFiles([...protoFiles(), ...workspaceFiles(),
    ...["edit-loop.mjs", "sysstat.mjs"].map((f) => ({ path: `${HOME}/${f}`, content: readFileSync(join(here, f)) }))])
  const t0 = Date.now()
  await Promise.all([
    installDesktop(sb),
    sh(sb, `cd ${HOME}/ws && npx -y pnpm@9.15.9 install --frozen-lockfile --filter homepage... >/tmp/pnpm.log 2>&1 || (tail -30 /tmp/pnpm.log; exit 1)`),
    sh(sb, `cd ${HOME}/proto && npm i --silent ws werift`),
  ])
  log(`stream setup ${Math.round((Date.now() - t0) / 1000)} s`)
  await sh(sb, `cd ${HOME}/ws/apps/homepage && PORT=3001 nohup npx next dev --turbopack --port 3001 >/tmp/next.log 2>&1 &`)
  const c0 = Date.now()
  await sh(sb, `for i in $(seq 1 600); do curl -sf -o /dev/null http://127.0.0.1:3001/ && exit 0; sleep 0.2; done; tail -30 /tmp/next.log; exit 1`)
  const coldCompileMs = Date.now() - c0
  const info = lastJson(await sh(sb, `node -e 'console.log(JSON.stringify({nproc: require("os").cpus().length, memMB: Math.round(require("os").totalmem()/2**20)}))'`))
  log(`next dev cold compile ${coldCompileMs} ms`, info)
  appendFileSync(OUT, JSON.stringify({ kind: "setup", vcpus, region: REGION, coldCompileMs, ...info }) + "\n")
  return sb
}

async function scenario(stream, viewer, vcpus, frames, page, load) {
  const server = await stream.runCommand({ cmd: "node", args: [`${HOME}/proto/server.mjs`, "--frames", String(frames), "--fps", String(FPS), "--page", page === "still" ? "" : page, "--decimate"], env: { CHROME }, detached: true })
  try {
    await sh(stream, `for i in $(seq 1 150); do curl -sf http://127.0.0.1:4990/frames >/dev/null && exit 0; sleep 0.2; done; exit 1`)
    await sleep(3000) // encoders up, Chrome settled
    const edits = load === "idle" ? null : await stream.runCommand({ cmd: "node", args: [`${HOME}/edit-loop.mjs`, "--dir", `${HOME}/ws/apps/homepage`, "--seconds", "50", ...(load === "tsc" ? ["--tsc"] : [])], detached: true })
    await sleep(load === "idle" ? 0 : 4000) // let compiles start
    const sys = await stream.runCommand({ cmd: "node", args: [`${HOME}/sysstat.mjs`, "--seconds", "30"], detached: true })
    const bench = await viewer.runCommand({ cmd: "node", args: [`${HOME}/proto/bench.mjs`, "--server", stream.domain(4990), "--n", "30", "--smooth", "5"], env: { CHROME } })
    const result = { kind: "scenario", vcpus, frames, page, load, fps: FPS, bench: lastJson(await bench.stdout()), sys: lastJson(await (await sys.wait()).stdout()) }
    if (edits) result.edits = lastJson(await (await edits.wait()).stdout())
    appendFileSync(OUT, JSON.stringify(result) + "\n")
    const b = result.bench
    log(`${vcpus} vCPU, ${frames}×${page}, ${load}: click p50 ${b.clickMs?.p50} ms, ${b.smoothness?.fps} fps (p99 gap ${b.smoothness?.p99}), cpu ${result.sys.cpuPct.avg}%, mem ${result.sys.memMB.max} MB${result.edits ? `, compile p50 ${result.edits.compileMs.p50} ms` : ""}`)
  } catch (e) {
    log(`${vcpus} vCPU, ${frames}×${page}, ${load}: FAILED`, e.message)
    appendFileSync(OUT, JSON.stringify({ kind: "scenario", vcpus, frames, page, load, error: e.message }) + "\n")
  } finally {
    await server.kill("SIGKILL").catch(() => {})
    await sh(stream, `pkill -9 -f "[e]dit-loop.mjs"; pkill -9 -f "[t]sc --noEmit"; pkill -9 chrome; pkill -9 Xvfb; pkill -9 ffmpeg; true`).catch(() => {})
    await sleep(1500)
  }
}

const viewer = await setupViewer()
const live = [viewer]
const stopAll = async () => { for (const sb of live) await sb.stop().catch(() => {}); log("stopped", live.map((s) => s.sandboxId).join(", ")) }
process.on("SIGINT", async () => { await stopAll(); process.exit(1) })
try {
  for (const vcpus of VCPUS) {
    const stream = await setupStream(vcpus)
    live.push(stream)
    for (const frames of FRAMES) for (const page of PAGES) for (const load of LOADS) await scenario(stream, viewer, vcpus, frames, page, load)
    await stream.stop()
    live.splice(live.indexOf(stream), 1)
    log(`stopped ${vcpus} vCPU sandbox`)
  }
} finally {
  await stopAll()
}
