#!/usr/bin/env node
// PROTOTYPE for #983: measures a running stream.prototype.mjs from a second headless Chrome acting
// as a viewer. It clicks (or presses F2 on) the demo's probe square and times how long until the
// square's new colour shows up in a decoded frame on the viewer: input-to-picture latency.
//
//   node stream.prototype.bench.mjs [--relay http://localhost:4983] [--zoom 1] [--n 40] [--page still|busy]
import { spawn } from "node:child_process"
import { mkdtempSync, existsSync } from "node:fs"
import { tmpdir, platform } from "node:os"
import { join } from "node:path"

const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const RELAY = arg("relay", "http://localhost:4983")
const ZOOM = Number(arg("zoom", 1))
const N = Number(arg("n", 40))
const PAGE = arg("page", "") // "", "still" or "busy": query for the demo page
const chromePath =
  arg("chrome", process.env.CHROME) ??
  (platform() === "darwin"
    ? ["/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)
    : "/opt/pw-browsers/chromium")

const chrome = spawn(chromePath, [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(join(tmpdir(), "bench-viewer-"))}`,
  "--window-size=1600,1000", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] })
process.on("exit", () => chrome.kill())
const wsUrl = await new Promise((r) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) r(m[1]) }) })
const targets = await (await fetch(wsUrl.replace(/^ws/, "http").replace(/\/devtools.*$/, "") + "/json/list")).json()
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m) }
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result.value

await cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await cdp("Page.navigate", { url: `${RELAY}/?zoom=${ZOOM}&name=bench` })
await new Promise((r) => setTimeout(r, 1500))
await evaluate(`new Promise((r) => { const ws = new WebSocket(location.origin.replace("http", "ws")); ws.onopen = () => { ws.send(JSON.stringify({ type: "navigate", url: location.origin + "/demo${PAGE ? "?" + PAGE : ""}" })); setTimeout(() => { ws.close(); r() }, 200) } })`)
await new Promise((r) => setTimeout(r, 2500))
if (arg("follow") === "off") {
  await evaluate(`send({ type: "follow-zoom", on: false })`)
  await new Promise((r) => setTimeout(r, 1000))
}
for (const [flag, type] of [["hover", "mouseMoved"], ["click", "mousePressed"]]) {
  if (!arg(flag)) continue
  const [x, y] = arg(flag).split(",").map(Number)
  await evaluate(`sendInput("mouse", { type: "${type}", x: ${x}, y: ${y}, button: "left", buttons: 1, clickCount: 1 })`)
  if (type === "mousePressed") await evaluate(`sendInput("mouse", { type: "mouseReleased", x: ${x}, y: ${y}, button: "left", buttons: 0, clickCount: 1 })`)
  await new Promise((r) => setTimeout(r, 800))
}
if (arg("type")) {
  for (const ch of arg("type")) {
    const key = ch === "\\" ? "Backspace" : ch
    const text = key.length === 1 ? key : undefined
    await evaluate(`sendInput("key", ${JSON.stringify({ type: text ? "keyDown" : "rawKeyDown", key, text, windowsVirtualKeyCode: text ? key.toUpperCase().charCodeAt(0) : 8 })}); sendInput("key", ${JSON.stringify({ type: "keyUp", key, windowsVirtualKeyCode: text ? key.toUpperCase().charCodeAt(0) : 8 })})`)
  }
  await new Promise((r) => setTimeout(r, 500))
}
if (arg("shot")) {
  const { data } = (await cdp("Page.captureScreenshot", { format: "png" })).result
  ;(await import("node:fs")).writeFileSync(arg("shot"), Buffer.from(data, "base64"))
  console.log(await evaluate(`JSON.stringify({ me, driver: state && state.driver, lastColor, W, H, sw: screen.width, sh: screen.height })`))
}
await evaluate(`send({ type: "take-control" })`)
await new Promise((r) => setTimeout(r, 500))
await fetch(`${RELAY}/stats?who=bench`) // start the bench's stats window
if (N === 0) process.exit(0)
const click = await evaluate(`runBench(${N}, "click")`)
const key = await evaluate(`runBench(${Math.round(N / 2)}, "key")`)
const stats = await (await fetch(`${RELAY}/stats?who=bench`)).json()
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v]))
console.log(JSON.stringify({ zoom: ZOOM, page: PAGE || "spinner", clickMs: round(click), keyMs: round(key), chrome: stats.chrome, stream: stats.stream }))
process.exit(0)
