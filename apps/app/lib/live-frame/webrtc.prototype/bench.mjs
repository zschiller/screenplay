#!/usr/bin/env node
// PROTOTYPE (shared live frame, video streaming), not for main. A second headless Chromium acts as a
// viewer of a running server.mjs: clicks (or presses F2 on) the demo's probe square and times how long
// until the square's new colour is on screen in the viewer (input → picture), then counts delivered
// frames and frame-interval jitter for judging animation smoothness.
//
//   node bench.mjs [--server http://127.0.0.1:4990] [--transport ws|webrtc] [--n 40] [--cpus 2,3] [--smooth 5]
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const SERVER = arg("server", "http://127.0.0.1:4990")
const TRANSPORT = arg("transport", "ws")
const N = Number(arg("n", 40))
const SMOOTH = Number(arg("smooth", 5))
const CPUS = arg("cpus", "")
const chromeArgs = [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(join(tmpdir(), "bench-viewer-"))}`,
  "--window-size=1400,1000", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", "about:blank",
]
const chromePath = process.env.CHROME ?? "/opt/pw-browsers/chromium"
const chrome = CPUS ? spawn("taskset", ["-c", CPUS, chromePath, ...chromeArgs], { stdio: ["ignore", "ignore", "pipe"] }) : spawn(chromePath, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] })
process.on("exit", () => chrome.kill("SIGKILL"))
const wsUrl = await new Promise((r) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) r(m[1]) }) })
const targets = await (await fetch(wsUrl.replace(/^ws/, "http").replace(/\/devtools.*$/, "") + "/json/list")).json()
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m) }
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await cdp("Page.navigate", { url: `${SERVER}/viewer?transport=${TRANSPORT}&name=bench` })
for (let t = 0; t < 40; t++) { await sleep(500); if (/ [1-9]\d* fps/.test(await evaluate(`document.getElementById("stats").textContent`))) break }
await sleep(1000)
await evaluate(`send({ type: "request" })`)
await sleep(500)
const decoding = await evaluate(`document.getElementById("stats").textContent`)
await fetch(`${SERVER}/stats`)
const smooth = SMOOTH ? await evaluate(`smoothness(${SMOOTH})`) : null
const server = await (await fetch(`${SERVER}/stats`)).json()
const click = N ? await evaluate(`runBench(${N}, "click")`) : null
const key = N ? await evaluate(`runBench(${Math.round(N / 2)}, "key")`) : null
const r = (o) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v]))
console.log(JSON.stringify({ transport: TRANSPORT, viewerStats: decoding, clickMs: r(click), keyMs: r(key), smoothness: smooth, server }))
process.exit(0)
