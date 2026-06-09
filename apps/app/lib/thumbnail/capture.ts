import "server-only"

import sharp from "sharp"
import { getBaseURL } from "@/lib/base-url"
import { BASE_PATH } from "@/lib/base-path"
import { blobStore } from "@/lib/blob"
import { setRoomThumbnail } from "@/lib/rooms"
import { thumbnailCapturer, type ThumbnailCapturer } from "./capturer"
import { signRenderToken } from "./token"

const THUMB_W = 640
const THUMB_H = 480

/**
 * Capture a Room's render page into a stored thumbnail and record its URL on
 * the Room. The screenshot itself comes from the injected
 * {@link ThumbnailCapturer} seam (default: headless Chromium); the `sharp`
 * resize, `BlobStore.put`, and `setRoomThumbnail` orchestration here is shared
 * across every capturer, so a sibling capturer (e.g. the desktop Tauri-webview
 * one) is a drop-in rather than a fork of this path.
 */
export async function captureRoomThumbnail(
  roomId: string,
  capturer: ThumbnailCapturer = thumbnailCapturer
): Promise<string> {
  const baseURL = getBaseURL()
  const token = signRenderToken(roomId)
  // The render page lives under the product's `/app` basePath, so the capturer
  // must hit `${origin}/app/${roomId}/render` — whether `${origin}` is the apex
  // (which proxies `/app/*` here) or this deploy's own URL.
  const renderUrl = `${baseURL}${BASE_PATH}/${roomId}/render?token=${encodeURIComponent(token)}`

  const pngBuffer = await capturer.capture(renderUrl)

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
