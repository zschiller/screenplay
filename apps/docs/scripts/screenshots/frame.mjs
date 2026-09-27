// Turn raw captures into the framed WebP images the docs embed:
// apps/docs/public/screenshots/<name>.light.webp and <name>.dark.webp.
//
//  - Full-window shots (manifest value `null`) are drawn in a Tauri-style
//    window: overlay title bar, traffic lights at the app's
//    `trafficLightPosition` (x 16, y 26), rounded corners, soft shadow.
//  - Detail shots (`[x, y, w, h]` in CSS px of the 1280×800 capture) are
//    magnified up to 1.6× and fade out on every edge that cuts through the UI.
//
// Both sit on a light or dark gradient matching the docs theme.
//
// Usage: node frame.mjs [name,name…]   (default: everything in manifest.json)
import fs from "node:fs"
import path from "node:path"
import { DOCS_PUBLIC, RAW_DIR, TOOL_DIR, VIEWPORT, appRequire, chromePath } from "./lib/env.mjs"

const puppeteer = appRequire("puppeteer-core")
const { $comment, ...manifest } = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, "manifest.json"), "utf8"))
const only = process.argv[2]?.split(",")

const W0 = VIEWPORT.width, H0 = VIEWPORT.height
const FADE = 56 // px of edge fade on cut sides

function html({ img, region, dark }) {
  const bg = dark
    ? "radial-gradient(90% 90% at 0% 0%, #2e2350 0%, transparent 60%), radial-gradient(90% 90% at 100% 100%, #13304d 0%, transparent 60%), #0b0b0f"
    : "radial-gradient(90% 90% at 0% 0%, #ffe6d5 0%, transparent 60%), radial-gradient(90% 90% at 100% 100%, #dde5ff 0%, transparent 60%), #f5f4f2"
  const border = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.09)"
  const shadow = `0 0 0 1px ${border}, 0 30px 70px -24px rgba(15,10,40,${dark ? 0.9 : 0.38}), 0 10px 24px -12px rgba(15,10,40,${dark ? 0.6 : 0.2})`
  const [x, y, w, h] = region ?? [0, 0, W0, H0]
  const s = region ? Math.min(1.6, 1280 / w, 900 / h) : 1360 / W0
  const dw = w * s, dh = h * s
  const width = region ? Math.round(Math.max(900, dw + 200)) : 1600
  const height = region ? Math.round(dh + 160) : 1060
  const cut = { l: x > 0, t: y > 0, r: x + w < W0, b: y + h < H0 }
  const anyCut = cut.l || cut.t || cut.r || cut.b
  const grad = (dir, a, z) =>
    `linear-gradient(${dir}, ${a ? "transparent" : "#000"} 0, #000 ${a ? FADE : 0}px, #000 calc(100% - ${z ? FADE : 0}px), ${z ? "transparent" : "#000"} 100%)`
  const mask = anyCut
    ? `-webkit-mask-image:${grad("to right", cut.l, cut.r)},${grad("to bottom", cut.t, cut.b)};-webkit-mask-composite:source-in;mask-composite:intersect;`
    : `box-shadow:${shadow};`
  const rad = (on) => (on ? 12 : 0)
  const radius = `border-radius:${rad(!cut.l && !cut.t)}px ${rad(!cut.r && !cut.t)}px ${rad(!cut.r && !cut.b)}px ${rad(!cut.l && !cut.b)}px;`
  // Tauri overlay title bar: macOS traffic lights drawn over the webview.
  const light = (cx, color) =>
    `<i style="position:absolute;left:${(cx - x - 6) * s}px;top:${(24 - y - 6) * s}px;width:${12 * s}px;height:${12 * s}px;border-radius:50%;background:${color};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)"></i>`
  const lights = x < 80 && y < 40 ? light(22, "#ff5f57") + light(42, "#febc2e") + light(62, "#28c840") : ""
  let inner = `<div style="position:relative;width:${dw}px;height:${dh}px;overflow:hidden;${radius}${mask}">
    <img src="${img}" style="position:absolute;left:${-x * s}px;top:${-y * s}px;width:${W0 * s}px;height:${H0 * s}px">${lights}</div>`
  if (anyCut)
    inner = `<div style="filter:drop-shadow(0 24px 40px rgba(15,10,40,${dark ? 0.7 : 0.22})) drop-shadow(0 0 1px ${border})">${inner}</div>`
  return {
    width,
    height,
    doc: `<!doctype html><body style="margin:0;width:${width}px;height:${height}px;background:${bg};display:flex;align-items:center;justify-content:center">${inner}</body>`,
  }
}

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
})
const p = await browser.newPage()
fs.mkdirSync(DOCS_PUBLIC, { recursive: true })
let missing = 0
for (const [name, region] of Object.entries(manifest)) {
  if (only && !only.includes(name)) continue
  for (const theme of ["light", "dark"]) {
    const src = path.join(RAW_DIR, theme, `${name}.png`)
    if (!fs.existsSync(src)) {
      console.warn(`  – missing raw ${theme}/${name}.png`)
      missing++
      continue
    }
    const img = `data:image/png;base64,${fs.readFileSync(src).toString("base64")}`
    const { width, height, doc } = html({ img, region, dark: theme === "dark" })
    await p.setViewport({ width, height, deviceScaleFactor: 1.5 })
    await p.setContent(doc, { waitUntil: "load" })
    await p.screenshot({ path: path.join(DOCS_PUBLIC, `${name}.${theme}.webp`), type: "webp", quality: 86 })
  }
  console.log(`  ✓ ${name}`)
}
await browser.close()
if (missing) console.warn(`${missing} raw capture(s) missing — run capture.mjs for them.`)
