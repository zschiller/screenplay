#!/usr/bin/env node
// PROTOTYPE (shared live frame, video streaming), not for main. Stands in for the model: asks for
// control through the same #981 gate as people, then drives the demo app to a state buried under
// Settings → Billing, including a native <select>, saving the real-display screenshot it gets back
// after each step (what a computer-use tool would return). Everyone watching the frame sees it live.
//
//   node agent.mjs [--server http://127.0.0.1:4990] [--frame 0] [--out ./shots] [--pace 600]
import { mkdirSync, writeFileSync } from "node:fs"

const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f)
const S = `${arg("server", "http://127.0.0.1:4990")}/agent/${arg("frame", 0)}`
const OUT = arg("out", "./shots")
const PACE = Number(arg("pace", 600)) // pause between steps so people watching can follow
mkdirSync(OUT, { recursive: true })
const post = async (op, body = {}) => {
  const r = await fetch(`${S}/${op}`, { method: "POST", body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`${op}: ${j.error}`)
  return j
}
// A real model would pick coordinates off the screenshot. The stand-in asks the page where things
// are, which is the DOM-assisted variant (cheaper and exact).
const centre = async (selector) => post("eval", { expression: `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()` })
let step = 0
const shot = async (label) => {
  const t0 = performance.now()
  const png = Buffer.from(await (await fetch(`${S}/screenshot`)).arrayBuffer())
  const name = `${String(++step).padStart(2, "0")}-${label}.png`
  writeFileSync(`${OUT}/${name}`, png)
  console.log(`${name}  (${Math.round(performance.now() - t0)} ms to screenshot)`)
}
const pause = () => new Promise((r) => setTimeout(r, PACE))

let state = await post("request")
if (state.driver !== "agent") {
  console.log(`waiting: ${state.driver} is driving; asked for control (queue: ${state.requests.join(", ")})`)
  while ((await post("state")).driver !== "agent") await new Promise((r) => setTimeout(r, 500))
}
console.log("agent is driving")
await shot("start")
await post("click", await centre('[data-page="settings"]')); await pause(); await shot("settings")
await post("click", await centre('[data-sub="billing"]')); await pause(); await shot("billing")
const seats = await centre("#seats")
await post("click", seats)
await post("eval", { expression: `document.querySelector("#seats").select()` })
await post("type", { text: "12" }); await pause(); await shot("seats")
await post("click", await centre("#plan")); await pause(); await shot("plan-menu-open")
// Native popup is open: arrow down twice (Hobby → Pro → Team) and Enter, like a person would.
for (let i = 0; i < 2; i++) await post("key", { key: "ArrowDown", code: "ArrowDown", keyCode: 40 })
await post("key", { key: "Enter", code: "Enter", keyCode: 13 }); await pause(); await shot("plan-picked")
await post("click", await centre("#upgrade")); await pause(); await shot("review")
await post("release")
console.log("released control")
