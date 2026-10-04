import "server-only"

import { lookup } from "node:dns/promises"
import sharp from "sharp"

import {
  buildPageScreenshotTools,
  FULL_PAGE_MAX_HEIGHT,
  type PageScreenshotFiles,
  type PageScreenshotPorts,
  type PageScreenshotScope,
} from "@/lib/agent/page-screenshot-tools"
import { isPrivateAddress } from "@/lib/agent/private-address"
import type { RoomDoc } from "@/lib/room-access"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import { framePageReader, thumbnailCapturer } from "@/lib/thumbnail/capturer"

/**
 * The longest a screenshot handed to the model may be on each side. Wide
 * enough to read UI text, as `view_frame`; tall enough for a whole page.
 */
const MODEL_MAX_WIDTH = 1280
const MODEL_MAX_HEIGHT = 8000

/** Ceiling on one render, as `view_frame`'s. */
const CAPTURE_TIMEOUT_MS = 30_000

/** The page's full height, read in the browser after it settles. */
const PAGE_HEIGHT_SCRIPT = `return String(Math.max(
  document.documentElement.scrollHeight,
  document.body ? document.body.scrollHeight : 0
))`

/**
 * The page screenshot ports over the live Room: renders through the
 * Thumbnail Capturer's browser (headless Chromium hosted, the shell's webview
 * on the desktop). Hosted, the server's browser only loads public pages, so a
 * URL can't reach the server's own network; the desktop renders whatever the
 * person's own machine can, their local dev servers included.
 */
export function livePageScreenshotPorts(room: RoomDoc): PageScreenshotPorts {
  return {
    readDoc: (fn) => room.readDoc(fn),

    async capturePage({ url, width, height, fullPage }) {
      if (!isLocalSandboxBackend()) await assertPublicUrl(url)
      let shotHeight = height
      let cut = false
      if (fullPage) {
        const measured = Number(
          await withTimeout(
            framePageReader.evaluate(
              url,
              { width, height },
              PAGE_HEIGHT_SCRIPT
            ),
            CAPTURE_TIMEOUT_MS
          )
        )
        if (Number.isFinite(measured) && measured > 0) {
          cut = measured > FULL_PAGE_MAX_HEIGHT
          shotHeight = Math.min(Math.ceil(measured), FULL_PAGE_MAX_HEIGHT)
        }
      }
      const png = await withTimeout(
        thumbnailCapturer.capture(url, { width, height: shotHeight }),
        CAPTURE_TIMEOUT_MS
      )
      const meta = await sharp(png).metadata()
      return {
        png,
        width: meta.width ?? width,
        height: meta.height ?? shotHeight,
        cut,
      }
    },

    async toModelImage(png) {
      const data = await sharp(png)
        .resize(MODEL_MAX_WIDTH, MODEL_MAX_HEIGHT, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer()
      return { data, mediaType: "image/webp" }
    },
  }
}

/**
 * `screenshot_page` for a chat, saving to the canvas's and the sender's
 * files. The in-process toolsets and a harness's MCP server all use it.
 */
export function chatPageScreenshotTools(opts: {
  room: RoomDoc
  files: PageScreenshotFiles
  scope?: PageScreenshotScope
}) {
  return buildPageScreenshotTools(
    livePageScreenshotPorts(opts.room),
    opts.files,
    opts.scope
  )
}

/** Throws unless every address `url`'s host resolves to is a public one. */
async function assertPublicUrl(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("only public pages can be screenshot here")
  }
  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error(`couldn’t find ${host}`)
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("only public pages can be screenshot here")
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}
