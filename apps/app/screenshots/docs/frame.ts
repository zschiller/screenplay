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

/**
 * Turn raw captures into the framed images the docs embed, on a light or dark
 * gradient that matches the docs theme:
 *
 * - **Full-window** screens (`crop` unset) are drawn as a Screenplay desktop
 *   window: the Tauri overlay title bar's traffic lights at the app's
 *   `trafficLightPosition`, rounded corners, and a soft shadow.
 * - **Detail** screens are cropped around their focus (measured from the
 *   screen's `focus` during capture, else its fixed `crop`): the focus centred
 *   with room around it, magnified up to 1.6×, in the same rounded card — a
 *   zoomed-in window, so a menu or dialog reads at a glance.
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
  const focusFile = join(rawDir, "focus.json")
  const measured: Record<string, Crop> = existsSync(focusFile)
    ? JSON.parse(await readFile(focusFile, "utf8"))
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
        const webp = await sharp(png).webp({ quality: 86 }).toBuffer()
        const out = join(DOCS_SCREENSHOT_DIR, `${screen.name}.${theme}.webp`)
        if (await looksTheSame(webp, out)) {
          unchanged++
          continue
        }
        await writeFile(out, webp)
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
  webp: Buffer,
  existingPath: string
): Promise<boolean> {
  if (!existsSync(existingPath)) return false
  const existing = await readFile(existingPath)
  if (existing.equals(webp)) return true
  // Compare the two encodings, so lossy-compression artifacts appear on both
  // sides rather than reading as a change.
  const [a, b] = await Promise.all([
    sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(existing).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
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

/** Room left around a detail's focus, and the smallest detail worth magnifying. */
const FOCUS_PAD = 64
const MIN_DETAIL = { width: 560, height: 360 }

/**
 * The region a detail shows: its focus centred, with {@link FOCUS_PAD} of
 * context on every side, grown to {@link MIN_DETAIL}, then slid (never
 * shrunk) to stay inside the window. The focus is always wholly inside it.
 */
export function detailRegion(
  focus: Crop,
  viewport: { width: number; height: number }
): Crop {
  const [fx, fy, fw, fh] = focus
  const w = Math.min(
    viewport.width,
    Math.max(fw + 2 * FOCUS_PAD, MIN_DETAIL.width)
  )
  const h = Math.min(
    viewport.height,
    Math.max(fh + 2 * FOCUS_PAD, MIN_DETAIL.height)
  )
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max))
  const x = clamp(Math.round(fx + fw / 2 - w / 2), viewport.width - w)
  const y = clamp(Math.round(fy + fh / 2 - h / 2), viewport.height - h)
  return [x, y, w, h]
}

function framePage(
  img: string,
  viewport: { width: number; height: number },
  focus: Crop | undefined,
  dark: boolean
): { width: number; height: number; html: string } {
  const { width: W0, height: H0 } = viewport
  const bg = dark
    ? "radial-gradient(90% 90% at 0% 0%, #2e2350 0%, transparent 60%), radial-gradient(90% 90% at 100% 100%, #13304d 0%, transparent 60%), #0b0b0f"
    : "radial-gradient(90% 90% at 0% 0%, #ffe6d5 0%, transparent 60%), radial-gradient(90% 90% at 100% 100%, #dde5ff 0%, transparent 60%), #f5f4f2"
  const border = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.09)"
  const shadow = `0 0 0 1px ${border}, 0 30px 70px -24px rgba(15,10,40,${dark ? 0.9 : 0.38}), 0 10px 24px -12px rgba(15,10,40,${dark ? 0.6 : 0.2})`
  const [x, y, w, h] = focus ? detailRegion(focus, viewport) : [0, 0, W0, H0]
  // Details are magnified (up to 1.6×) and may run tall — a long menu, a
  // whole dialog — rather than shrink.
  const s = focus ? Math.min(1.6, 1200 / w, 1100 / h) : 1360 / W0
  const dw = w * s
  const dh = h * s
  const width = focus ? Math.round(Math.max(900, dw + 240)) : 1600
  const height = Math.round(dh + (focus ? 200 : 210))
  // The Tauri overlay title bar: macOS traffic lights drawn over the webview
  // at the window's `trafficLightPosition` (x 16, y 26 in the app config),
  // whenever the region includes the window's top-left corner.
  const light = (cx: number, color: string) =>
    `<i style="position:absolute;left:${(cx - x - 6) * s}px;top:${(24 - y - 6) * s}px;width:${12 * s}px;height:${12 * s}px;border-radius:50%;background:${color};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)"></i>`
  const lights =
    x <= 10 && y <= 12
      ? light(22, "#ff5f57") + light(42, "#febc2e") + light(62, "#28c840")
      : ""
  // Window and detail alike sit in one rounded, bordered card: a detail reads
  // as a zoomed-in window, with the focus centred and only context at its
  // edges.
  const inner = `<div style="position:relative;width:${dw}px;height:${dh}px;overflow:hidden;border-radius:${focus ? 16 : 12}px;box-shadow:${shadow}">
    <img src="${img}" style="position:absolute;left:${-x * s}px;top:${-y * s}px;width:${W0 * s}px;height:${H0 * s}px">${lights}</div>`
  return {
    width,
    height,
    html: `<!doctype html><body style="margin:0;width:${width}px;height:${height}px;background:${bg};display:flex;align-items:center;justify-content:center">${inner}</body>`,
  }
}
