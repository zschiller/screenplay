import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import type { CaptureProfile } from "../profile"
import { launchBrowser, type Theme } from "../lib/browser"
import { DOCS_VIEWPORT, type Crop, type DocsScreen } from "./screens"

/** Where the docs site serves its screenshots from. */
export const DOCS_SCREENSHOT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/public/screenshots"
)

/** Edge fade, in px, on every side a detail crop cuts through the UI. */
const FADE = 56

/**
 * Turn raw captures into the framed images the docs embed, on a light or dark
 * gradient that matches the docs theme:
 *
 * - **Full-window** screens (`crop` unset) are drawn as a Screenplay desktop
 *   window: the Tauri overlay title bar's traffic lights at the app's
 *   `trafficLightPosition`, rounded corners, and a soft shadow.
 * - **Detail** screens (a `crop` measured from the screen's `focus` during
 *   capture, else its fixed `crop`, in CSS px) are magnified up to 1.6× and
 *   fade out on every edge that cuts through the UI, so a menu or dialog reads
 *   at a glance.
 */
export async function frameScreens(
  profile: CaptureProfile,
  options: {
    label: string
    screens: readonly DocsScreen[]
    themes: readonly Theme[]
  }
): Promise<void> {
  const rawDir = join(profile.captureRoot, options.label)
  await mkdir(DOCS_SCREENSHOT_DIR, { recursive: true })
  const browser = await launchBrowser()
  // 1.5× keeps text crisp on a retina display without bloating the files.
  const page = await browser.newPage({ deviceScaleFactor: 1.5 })
  const cropsFile = join(rawDir, "crops.json")
  const measured: Record<string, Crop> = existsSync(cropsFile)
    ? JSON.parse(await readFile(cropsFile, "utf8"))
    : {}
  let missing = 0
  let written = 0
  let unchanged = 0
  try {
    for (const screen of options.screens) {
      for (const theme of options.themes) {
        const src = join(rawDir, `${screen.name}.${theme}.png`)
        if (!existsSync(src)) {
          console.warn(`  – no capture for ${screen.name}.${theme}`)
          missing++
          continue
        }
        const img = `data:image/png;base64,${(await readFile(src)).toString("base64")}`
        const { width, height, html } = framePage(
          img,
          screen.viewport ?? DOCS_VIEWPORT,
          measured[`${screen.name}.${theme}`] ?? screen.crop,
          theme === "dark"
        )
        await page.setViewportSize({ width, height })
        await page.setContent(html, { waitUntil: "load" })
        const png = await page.screenshot()
        const out = join(DOCS_SCREENSHOT_DIR, `${screen.name}.${theme}.webp`)
        if (await looksTheSame(png, out)) {
          unchanged++
          continue
        }
        await writeFile(out, await sharp(png).webp({ quality: 86 }).toBuffer())
        written++
      }
      console.log(`  ✓ ${screen.name}`)
    }
  } finally {
    await browser.close()
  }
  console.log(`Framed: ${written} updated, ${unchanged} unchanged.`)
  if (missing) console.warn(`${missing} capture(s) missing.`)
}

/** Share of pixels that may differ before a re-render counts as a change. */
const CHANGED_PIXELS = 0.0005
/** Per-channel difference below which a pixel counts as the same. */
const CHANNEL_TOLERANCE = 24

/**
 * Whether a fresh render matches the committed image closely enough to keep
 * the committed one. Encoding and anti-aliasing jitter move a handful of
 * pixels between runs; without this, every regeneration would rewrite every
 * file and a continuous refresh would never go quiet.
 */
async function looksTheSame(
  png: Buffer,
  existingPath: string
): Promise<boolean> {
  if (!existsSync(existingPath)) return false
  const [a, b] = await Promise.all([
    sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(existingPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ])
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return false
  }
  let differing = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i]! - b.data[i]!) > CHANNEL_TOLERANCE ||
      Math.abs(a.data[i + 1]! - b.data[i + 1]!) > CHANNEL_TOLERANCE ||
      Math.abs(a.data[i + 2]! - b.data[i + 2]!) > CHANNEL_TOLERANCE
    ) {
      differing++
    }
  }
  return differing / (a.data.length / 4) < CHANGED_PIXELS
}

function framePage(
  img: string,
  viewport: { width: number; height: number },
  crop: Crop | undefined,
  dark: boolean
): { width: number; height: number; html: string } {
  const { width: W0, height: H0 } = viewport
  const bg = dark
    ? "radial-gradient(90% 90% at 0% 0%, #2e2350 0%, transparent 60%), radial-gradient(90% 90% at 100% 100%, #13304d 0%, transparent 60%), #0b0b0f"
    : "radial-gradient(90% 90% at 0% 0%, #ffe6d5 0%, transparent 60%), radial-gradient(90% 90% at 100% 100%, #dde5ff 0%, transparent 60%), #f5f4f2"
  const border = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.09)"
  const shadow = `0 0 0 1px ${border}, 0 30px 70px -24px rgba(15,10,40,${dark ? 0.9 : 0.38}), 0 10px 24px -12px rgba(15,10,40,${dark ? 0.6 : 0.2})`
  const [x, y, w, h] = crop ?? [0, 0, W0, H0]
  // Detail crops may run tall (a long menu, a whole dialog) rather than shrink.
  const s = crop ? Math.min(1.6, 1280 / w, 1150 / h) : 1360 / W0
  const dw = w * s
  const dh = h * s
  const width = crop ? Math.round(Math.max(900, dw + 200)) : 1600
  const height = crop ? Math.round(dh + 160) : Math.round(dh + 210)
  const cut = { l: x > 0, t: y > 0, r: x + w < W0, b: y + h < H0 }
  const anyCut = cut.l || cut.t || cut.r || cut.b
  const grad = (dir: string, a: boolean, z: boolean) =>
    `linear-gradient(${dir}, ${a ? "transparent" : "#000"} 0, #000 ${a ? FADE : 0}px, #000 calc(100% - ${z ? FADE : 0}px), ${z ? "transparent" : "#000"} 100%)`
  const mask = anyCut
    ? `-webkit-mask-image:${grad("to right", cut.l, cut.r)},${grad("to bottom", cut.t, cut.b)};-webkit-mask-composite:source-in;mask-composite:intersect;`
    : `box-shadow:${shadow};`
  const r = (on: boolean) => (on ? 12 : 0)
  const radius = `border-radius:${r(!cut.l && !cut.t)}px ${r(!cut.r && !cut.t)}px ${r(!cut.r && !cut.b)}px ${r(!cut.l && !cut.b)}px;`
  // The Tauri overlay title bar: macOS traffic lights drawn over the webview
  // at the window's `trafficLightPosition` (x 16, y 26 in the app config).
  const light = (cx: number, color: string) =>
    `<i style="position:absolute;left:${(cx - x - 6) * s}px;top:${(24 - y - 6) * s}px;width:${12 * s}px;height:${12 * s}px;border-radius:50%;background:${color};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)"></i>`
  const lights =
    x < 80 && y < 40
      ? light(22, "#ff5f57") + light(42, "#febc2e") + light(62, "#28c840")
      : ""
  let inner = `<div style="position:relative;width:${dw}px;height:${dh}px;overflow:hidden;${radius}${mask}">
    <img src="${img}" style="position:absolute;left:${-x * s}px;top:${-y * s}px;width:${W0 * s}px;height:${H0 * s}px">${lights}</div>`
  if (anyCut) {
    inner = `<div style="filter:drop-shadow(0 24px 40px rgba(15,10,40,${dark ? 0.7 : 0.22})) drop-shadow(0 0 1px ${border})">${inner}</div>`
  }
  return {
    width,
    height,
    html: `<!doctype html><body style="margin:0;width:${width}px;height:${height}px;background:${bg};display:flex;align-items:center;justify-content:center">${inner}</body>`,
  }
}
