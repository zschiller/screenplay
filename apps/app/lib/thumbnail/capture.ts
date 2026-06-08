import "server-only"

import sharp from "sharp"
import { getBaseURL } from "@/lib/base-url"
import { BASE_PATH } from "@/lib/base-path"
import { blobStore } from "@/lib/blob"
import { setRoomThumbnail } from "@/lib/rooms"
import { signRenderToken } from "./token"

const VIEWPORT_W = 1280
const VIEWPORT_H = 960
const NAV_TIMEOUT_MS = 15_000
const READY_TIMEOUT_MS = 9_000
const THUMB_W = 640
const THUMB_H = 480

type Browser = import("puppeteer-core").Browser

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default

  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  const executablePath =
    process.env.CHROMIUM_PATH ??
    (await import("puppeteer")).default.executablePath()

  return puppeteer.launch({
    headless: true,
    defaultViewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    executablePath,
  })
}

export async function captureRoomThumbnail(roomId: string): Promise<string> {
  const baseURL = getBaseURL()
  const token = signRenderToken(roomId)
  // The render page lives under the product's `/app` basePath, so the headless
  // browser must hit `${origin}/app/${roomId}/render` — whether `${origin}` is
  // the apex (which proxies `/app/*` here) or this deploy's own URL.
  const renderUrl = `${baseURL}${BASE_PATH}/${roomId}/render?token=${encodeURIComponent(token)}`

  const browser = await launchBrowser()
  let pngBuffer: Buffer
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H })
    await page.goto(renderUrl, { waitUntil: "load", timeout: NAV_TIMEOUT_MS })

    await page
      .waitForFunction(() => (window as Window).__thumbnailReady === true, {
        timeout: READY_TIMEOUT_MS,
      })
      .catch(() => {
        // Fall through with whatever has rendered so far.
      })

    const element = await page.$("[data-thumbnail-root]")
    const target = element ?? page
    const screenshot = await target.screenshot({ type: "png" })
    pngBuffer = Buffer.from(screenshot)
  } finally {
    await browser.close().catch(() => {})
  }

  const webp = await sharp(pngBuffer)
    .resize(THUMB_W, THUMB_H, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer()

  const { url } = await blobStore.put(`thumbnails/${roomId}.webp`, webp, {
    contentType: "image/webp",
    cacheControlMaxAge: 60,
  })

  await setRoomThumbnail(roomId, url)
  return url
}
