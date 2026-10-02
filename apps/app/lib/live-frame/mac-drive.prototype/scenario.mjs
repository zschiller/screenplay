#!/usr/bin/env node
// PROTOTYPE (#1367) — throwaway. Drives the lab page (drive-lab.page.tsx.txt,
// dropped into a Workspace's Next app as app/drive-lab/page.tsx) through the
// relay and prints what worked, what didn't and how long it took.
//
//   MAC_DRIVE_PROTOTYPE_TOKEN=… node scenario.mjs <port> <roomId> <frameId> [outDir]
import { mkdirSync, writeFileSync } from "node:fs"

import { call, drive, query } from "./agent.mjs"

const outDir = process.argv[5] || "./out"
mkdirSync(outDir, { recursive: true })

const sel = (selector) => ({ selector })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const timings = { click: [], type: [], key: [], list: [], snapshot: [], pageSnapshot: [] }

async function op(o) {
  const r = await drive(o)
  if (r.ok && r.ms && timings[o.op]) timings[o.op].push(r.ms)
  return r
}
async function read(selector) {
  const r = await drive({ op: "read", target: sel(selector) })
  return r.ok ? r.value : null
}
const logText = async () => (await read("#log"))?.text ?? ""
async function shot(name) {
  const r = await call({ kind: "snapshot" })
  if (!r.png) return console.log("snapshot failed", r)
  writeFileSync(`${outDir}/${name}.png`, r.png)
  timings.snapshot.push(r.ms)
  return r
}
function record(name, pass, note) {
  results.push({ name, pass, note })
  console.log(`${pass ? "✓" : "✗"} ${name}${note ? "  — " + note : ""}`)
}
async function probe(name, target) {
  const r = await drive({ op: "probe", name, target })
  return r.ok ? r.value : { ok: false, error: r.error }
}

// --- A. drive to a buried state: Settings → Billing dialog → saved plan ------
await call({ kind: "relay", message: { type: "screenplay:navigate", path: "/drive-lab" } })
await sleep(1500)
await shot("01-home")
await op({ op: "click", target: { text: "Settings" } })
await op({ op: "click", target: { text: "Billing…" } })
record("open a dialog two clicks deep", !!(await read("#billing")))
await op({ op: "type", target: sel("#email"), text: "agent@example.com" })
await op({ op: "type", target: sel("#seats"), text: "12", replace: true })
record("type into React controlled inputs", (await read("#email"))?.value === "agent@example.com" && (await read("#seats"))?.value === "12")
const sp = await probe("showPicker", sel("#plan"))
record("open a native <select> popup", sp.ok, sp.error)
await op({ op: "select", target: sel("#plan"), value: "Team" })
record("set a native <select> by value", (await read("#plan"))?.value === "team")
await op({ op: "click", target: sel("#region-trigger") })
await shot("02-dialog-menu-open")
const menuOpen = !!(await read('[role="menu"]'))
await op({ op: "click", target: { text: "eu-west", tag: '[role="menuitem"]' } })
record("custom menu that opens on pointerdown", menuOpen && /eu-west/.test((await read("#region-trigger"))?.text))
await op({ op: "click", target: sel("#annual") })
record("toggle a checkbox", (await read("#annual"))?.checked === true)
const enter = await op({ op: "key", target: sel("#email"), key: "Enter" })
await sleep(100)
const saved = (await read("#saved"))?.text
record("Enter submits the form", /agent@example.com · 12 seats · team · eu-west · annual/.test(saved || ""), `${saved} (${enter.value?.detail?.emulated ?? "native"})`)
await shot("03-saved")

// --- B. the gestures an untrusted event might not perform --------------------
const ua = await probe("userActivation")
record("frame has user activation", !!ua.value?.isActive, JSON.stringify(ua.value))

await op({ op: "click", target: sel("#file") })
await sleep(300)
const fp = await probe("showPicker", sel("#file"))
record("open the file picker", fp.ok && false, `click reached the page (${/file click trusted=false/.test(await logText()) ? "untrusted" : "?"}); showPicker: ${fp.ok ? "no error" : fp.error}`)
const dp = await probe("showPicker", sel("#date"))
record("open a date picker", dp.ok, dp.error)
await op({ op: "type", target: sel("#date"), text: "2026-10-02", replace: true })
record("set a date input by value", (await read("#date"))?.value === "2026-10-02")

await op({ op: "click", target: sel("#copy") })
await sleep(300)
const copyLog = (await logText()).split("\n").filter((l) => l.startsWith("copy")).pop()
record("page's own copy button (clipboard.writeText)", /copy ok/.test(copyLog || ""), copyLog)
for (const name of ["clipboardWrite", "clipboardRead", "execCopy", "execPaste"]) {
  const r = await probe(name, sel("#paste"))
  record(`probe ${name}`, r.ok && r.value !== false, r.ok ? JSON.stringify(r.value) : r.error)
}

await op({ op: "hover", target: sel("#hover-trigger") })
const hov = await probe("matchesHover", sel("#hover-trigger"))
const list = await drive({ op: "listInteractive" })
const exportShown = list.value.elements.some((e) => e.label === "Export")
record("CSS :hover menu", hov.value === true && exportShown, `:hover=${hov.value}, JS mouseenter ${/mouseenter hover-trigger/.test(await logText()) ? "fired" : "did not fire"}`)

await op({ op: "type", target: sel("#note"), text: "hello" })
await op({ op: "key", target: sel("#note"), key: "Enter", modifiers: { metaKey: true } })
record("keyboard shortcut handled by the page (⌘Enter)", /sent note: hello/.test(await logText()))
await op({ op: "key", target: sel("#note"), key: "x" })
record("a key event types its character", (await read("#note"))?.value === "hellox", `value=${(await read("#note"))?.value}`)
const beforeTab = (await op({ op: "key", target: sel("#note"), key: "Tab" })).value?.active?.selector
record("Tab moves focus", beforeTab !== "#note", `active after Tab: ${beforeTab}`)
await op({ op: "type", target: sel("#editable"), text: "rich text" })
record("type into contenteditable (execCommand)", /rich text/.test((await read("#editable"))?.text || ""))

await op({ op: "drag", html5: true, target: sel("#dnd li:nth-of-type(1)"), to: sel("#dnd li:nth-of-type(3)") })
record("HTML5 drag and drop (synthetic DataTransfer)", /^bravo/.test((await read("#dnd"))?.text || ""), (await read("#dnd"))?.text.replace(/\n/g, ","))
await op({ op: "drag", target: { x: 0, y: 0, selector: "#slider" }, to: sel("#slider-value") })
const sv = (await read("#slider-value"))?.text
const cap = (await logText()).split("\n").filter((l) => l.startsWith("capture")).pop()
record("pointer drag (slider)", sv !== "slider: 0", `${sv}; setPointerCapture: ${cap}`)

const s1 = await op({ op: "scroll", target: sel("#scroller"), dy: 5000 })
record("scroll an inner scroller", s1.value?.detail?.after?.[1] > 0, JSON.stringify(s1.value?.detail))
const s2 = await op({ op: "scroll", dy: 400 })
record("scroll the page", s2.value?.detail?.after?.[1] >= 400, JSON.stringify(s2.value?.detail))
await op({ op: "click", target: sel("#bottom") })
record("click something below the fold", /clicked bottom/.test(await logText()))
await shot("04-scrolled")

const nav = await op({ op: "click", target: sel("#back") })
await sleep(800)
const after = await drive({ op: "listInteractive" })
record("follow a client-side link", after.value?.path === "/", `path ${nav.value?.path} → ${after.value?.path}`)
await shot("05-landing")
await call({ kind: "relay", message: { type: "screenplay:navigate", path: "/drive-lab" } })
await sleep(1500)

// --- C. timing --------------------------------------------------------------
for (let i = 0; i < 40; i++) {
  await op({ op: "click", target: { text: i % 2 ? "Home" : "Settings" } })
}
for (let i = 0; i < 20; i++) {
  const r = await drive({ op: "listInteractive" })
  timings.list.push(r.ms)
}
for (let i = 0; i < 10; i++) {
  const t = Date.now()
  const r = await query("getPageSnapshot")
  timings.pageSnapshot.push({ total: Date.now() - t, bytes: JSON.stringify(r.value || "").length })
}
for (let i = 0; i < 10; i++) await shot("06-timing")

const pct = (xs, p) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null
}
const summary = {}
for (const [k, rows] of Object.entries(timings)) {
  if (!rows.length) continue
  summary[k] = { n: rows.length }
  for (const field of Object.keys(rows[0]))
    summary[k][field] = [pct(rows.map((r) => r[field]), 50), pct(rows.map((r) => r[field]), 90)]
}
console.log(JSON.stringify(summary, null, 1))
writeFileSync(`${outDir}/results.json`, JSON.stringify({ results, summary }, null, 1))
