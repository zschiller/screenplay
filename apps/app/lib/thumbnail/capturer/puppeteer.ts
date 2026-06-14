import "server-only"

import type { CaptureViewport, ThumbnailCapturer } from "./types"

// Fallback viewport for a frame with no usable size (defensive — every real
// frame carries its own width/height).
const DEFAULT_VIEWPORT_W = 1280
const DEFAULT_VIEWPORT_H = 960
const NAV_TIMEOUT_MS = 15_000

type Browser = import("puppeteer-core").Browser

/**
 * The Chromium viewport for a frame: its **own** width and height, 1:1, with no
 * scaling. The live canvas renders each iframe layer at exactly these dimensions
 * (`iframe-layer.tsx`), so capturing at the same size makes the page lay out at
 * the same responsive breakpoint / fixed-width design it shows on the canvas —
 * anything narrower would reflow or clip the content, distorting the screenshot.
 * The downstream `sharp` resize shrinks the final blob to a thumbnail-sized webp,
 * so a large render only costs transient memory, not output size. Rounded to
 * whole pixels with a 1px floor so a degenerate dimension still yields a valid
 * viewport. (The Tauri-webview capturer already sizes its webview the same way.)
 */
function resolveViewport(viewport: CaptureViewport): {
  width: number
  height: number
} {
  const { width, height } = viewport
  if (!(width > 0) || !(height > 0)) {
    return { width: DEFAULT_VIEWPORT_W, height: DEFAULT_VIEWPORT_H }
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default

  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  const executablePath =
    process.env.CHROMIUM_PATH ??
    (await import("puppeteer")).default.executablePath()

  return puppeteer.launch({
    headless: true,
    executablePath,
  })
}

/**
 * The default Thumbnail Capturer: a headless Chromium that loads a frame's live
 * preview URL, sizes its viewport to the frame's own shape, waits for `load`,
 * and screenshots whatever has rendered, so an arbitrary preview still yields a
 * frame at the frame's aspect ratio.
 */
class PuppeteerCapturer implements ThumbnailCapturer {
  async capture(previewUrl: string, viewport: CaptureViewport): Promise<Buffer> {
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport(resolveViewport(viewport))
      await page.goto(previewUrl, { waitUntil: "load", timeout: NAV_TIMEOUT_MS })

      const screenshot = await page.screenshot({ type: "png" })
      return Buffer.from(screenshot)
    } finally {
      await browser.close().catch(() => {})
    }
  }
}

export function getPuppeteerCapturer(): ThumbnailCapturer {
  return new PuppeteerCapturer()
}
