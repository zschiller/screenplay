#!/usr/bin/env node
// PROTOTYPE, not for main. Times how long a viewer joining a frame waits for its first picture
// (socket open → first decoded frame), N times, opening and closing the viewer each time. With
// `server.mjs --pause viewers` every join is a resume from a paused encoder.
//   node join.mjs [--server http://127.0.0.1:4990] [--n 10] [--gap 1500] [--cpus 2,3]
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const SERVER = arg("server", "http://127.0.0.1:4990")
const N = Number(arg("n", 10)), GAP = Number(arg("gap", 1500)), CPUS = arg("cpus", "")
const chromePath = process.env.CHROME ?? "/opt/pw-browsers/chromium"
const a = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(join(tmpdir(), "join-"))}`, "--no-sandbox", "about:blank"]
const chrome = CPUS ? spawn("taskset", ["-c", CPUS, chromePath, ...a], { stdio: ["ignore", "ignore", "pipe"] }) : spawn(chromePath, a, { stdio: ["ignore", "ignore", "pipe"] })
process.on("exit", () => chrome.kill("SIGKILL"))
const wsUrl = await new Promise((r) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) r(m[1]) }) })
const t = await (await fetch(wsUrl.replace(/^ws/, "http").replace(/\/devtools.*$/, "") + "/json/list")).json()
const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m) }
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result.result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const times = []
for (let k = 0; k < N; k++) {
  await cdp("Page.navigate", { url: "about:blank" })
  await sleep(GAP) // nobody watching: a paused server stops the encoder here
  await cdp("Page.navigate", { url: `${SERVER}/viewer?transport=ws&name=join` })
  let v = null
  for (let w = 0; w < 100 && v == null; w++) { await sleep(25); v = await ev("window.firstPicture") }
  times.push(v)
}
const s = times.filter((x) => x != null).sort((x, y) => x - y)
console.log(JSON.stringify({ n: N, lost: N - s.length, p50: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], all: times }))
process.exit(0)
