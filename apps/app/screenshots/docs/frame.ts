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
 * Turn raw captures into the images the docs embed:
 *
 * - **Full-window** screens (`crop` unset) are drawn as a Screenplay desktop
 *   window on a flat light or dark backdrop that matches the docs theme: the
 *   Tauri overlay title bar's traffic lights at the app's
 *   `trafficLightPosition`, rounded corners, and a soft shadow. A screen
 *   with a `browser` address is drawn as a plain browser window instead (the
 *   prototype player opens in the user's browser, not the app): a title bar
 *   with the traffic lights and that address, and the page below it.
 * - **Detail** screens are cropped around their focus (measured from the
 *   screen's `focus` during capture, else its fixed `crop`): the focus centred
 *   with room around it, as the bare UI with no chrome, shadow or backdrop.
 *   A crop that comes close to the window's edge is pushed out to it, so it
 *   shows the window's edge instead of labels sliced a few letters in.
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
          theme === "dark",
          screen.browser
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
export async function looksTheSame(
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
 * A detail edge this close to the window's edge (CSS px) is pushed out to it,
 * so the image shows the window's real edge instead of a sliver of it. Near
 * the top-left corner it reaches further, so a detail by the sidebar shows
 * the traffic lights and whole labels rather than slicing them a few letters
 * in; elsewhere it would mostly add empty canvas or push a dialog off-centre.
 */
const EDGE_SNAP = { corner: 120, edge: 48 }

/**
 * The region a detail shows: its focus centred, with {@link FOCUS_PAD} of
 * context on every side, grown to {@link MIN_DETAIL}, then slid (never
 * shrunk) to stay inside the window. Edges that land within
 * {@link EDGE_SNAP} of the window's edge are extended to it. The focus is
 * always wholly inside it.
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
  const x0 = clamp(Math.round(fx + fw / 2 - w / 2), viewport.width - w)
  const y0 = clamp(Math.round(fy + fh / 2 - h / 2), viewport.height - h)
  const corner = x0 <= EDGE_SNAP.corner && y0 <= EDGE_SNAP.corner
  const snap = (start: number, size: number, max: number): [number, number] => {
    let end = start + size
    if (corner || start <= EDGE_SNAP.edge) start = 0
    if (max - end <= EDGE_SNAP.edge) end = max
    return [start, end - start]
  }
  const [x, sw] = snap(x0, w, viewport.width)
  const [y, sh] = snap(y0, h, viewport.height)
  return [x, y, sw, sh]
}

function framePage(
  img: string,
  viewport: { width: number; height: number },
  focus: Crop | undefined,
  dark: boolean,
  browser?: string
): { width: number; height: number; html: string } {
  const { width: W0, height: H0 } = viewport
  // Flat, like the docs' Editorial theme: a step off its white or black page.
  const bg = dark ? "#111111" : "#f0f0f0"
  const border = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.09)"
  const shadow = `0 0 0 1px ${border}, 0 30px 70px -24px rgba(15,10,40,${dark ? 0.9 : 0.38}), 0 10px 24px -12px rgba(15,10,40,${dark ? 0.6 : 0.2})`
  const [x, y, w, h] = focus ? detailRegion(focus, viewport) : [0, 0, W0, H0]
  // Details are magnified (up to 1.6×) and may run tall — a long menu, a
  // whole dialog — rather than shrink.
  const s = focus ? Math.min(1.6, 1200 / w, 1100 / h) : 1360 / W0
  const dw = w * s
  const dh = h * s
  // A detail is the cropped UI alone, with no window chrome, shadow or
  // backdrop: the docs page gives it rounded corners and a hairline border.
  if (focus) {
    const width = Math.round(dw)
    const height = Math.round(dh)
    return {
      width,
      height,
      html: `<!doctype html><body style="margin:0;width:${width}px;height:${height}px;overflow:hidden;position:relative">
    <img src="${img}" style="position:absolute;left:${-x * s}px;top:${-y * s}px;width:${W0 * s}px;height:${H0 * s}px"></body>`,
    }
  }
  const width = 1600
  // A browser window's title bar, in capture px, above the page.
  const bar = browser ? BROWSER_BAR : 0
  const height = Math.round(dh + bar * s + 210)
  // The Tauri overlay title bar: macOS traffic lights drawn over the webview
  // at the window's `trafficLightPosition` (x 16, y 26 in the app config). A
  // browser's sit in the middle of its own title bar.
  const cy = browser ? bar / 2 : 24
  const light = (cx: number, color: string) =>
    `<i style="position:absolute;left:${(cx - 6) * s}px;top:${(cy - 6) * s}px;width:${12 * s}px;height:${12 * s}px;border-radius:50%;background:${color};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)"></i>`
  const lights =
    light(22, "#ff5f57") + light(42, "#febc2e") + light(62, "#28c840")
  const titleBar = browser
    ? `<div style="position:absolute;left:0;top:0;width:${dw}px;height:${bar * s}px;background:${dark ? "#232326" : "#f4f4f5"};box-shadow:inset 0 -1px 0 ${border};display:flex;align-items:center;justify-content:center">
      <div style="width:${460 * s}px;height:${26 * s}px;border-radius:${7 * s}px;background:${dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.05)"};color:${dark ? "#a1a1aa" : "#52525b"};font:${12 * s}px/${26 * s}px -apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 ${12 * s}px;box-sizing:border-box">${escapeHtml(browser)}</div>${lights}</div>`
    : lights
  const inner = `<div style="position:relative;width:${dw}px;height:${dh + bar * s}px;overflow:hidden;border-radius:12px;box-shadow:${shadow}">
    <img src="${img}" style="position:absolute;left:0;top:${bar * s}px;width:${W0 * s}px;height:${H0 * s}px">${titleBar}</div>`
  return {
    width,
    height,
    html: `<!doctype html><body style="margin:0;width:${width}px;height:${height}px;background:${bg};display:flex;align-items:center;justify-content:center">${inner}</body>`,
  }
}

/** A browser window's title bar height, in CSS px of the capture. */
const BROWSER_BAR = 40

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
