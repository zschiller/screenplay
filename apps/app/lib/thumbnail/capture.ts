import "server-only"

import sharp from "sharp"
import { blobStore } from "@/lib/blob"
import { setRoomThumbnailManifest } from "@/lib/rooms"
import {
  buildThumbnailManifest,
  type FrameCapture,
  type ThumbnailManifest,
} from "./manifest"
import { readRoomCaptureLayout } from "./room-layout"
import { thumbnailCapturer, type ThumbnailCapturer } from "./capturer"

// The longest side a stored Frame Capture is resized to. The homescreen grid
// scales each capture into a small card, so a frame-sized webp is plenty —
// keeping the blobs small keeps the per-Room manifest read cheap to render.
const MAX_FRAME_DIM = 512

/**
 * Capture a Room's thumbnail as a per-frame composite. Reads the room's layout
 * once (`readRoomCaptureLayout`), screenshots each ready Iframe Layer's live
 * preview URL through the injected {@link ThumbnailCapturer} seam — called once
 * per frame — resizes and stores each capture, then builds and persists the
 * {@link ThumbnailManifest} on the Room row. No single baked `thumbnailUrl`
 * anymore: the grid composes positioned images from the manifest at display
 * time.
 *
 * This slice handles the simple "every frame is ready" case (#468): a frame
 * with no preview URL is skipped and lands in the manifest captureless. The
 * `sharp` resize, `BlobStore.put`, and Room write are shared across capturers,
 * so a sibling capturer (the desktop Tauri-webview one) stays a drop-in.
 */
export async function captureRoomThumbnail(
  roomId: string,
  capturer: ThumbnailCapturer = thumbnailCapturer
): Promise<ThumbnailManifest> {
  const { layouts, frames } = await readRoomCaptureLayout(roomId)

  const captures = new Map<string, FrameCapture>()
  for (const frame of frames) {
    const layout = layouts.get(frame.id)
    if (!frame.previewUrl || !layout) continue

    const pngBuffer = await capturer.capture(frame.previewUrl)

    // Resize to the frame's own aspect ratio, capped at MAX_FRAME_DIM on the
    // long side — the manifest carries the rect, so the capture only has to
    // look right when scaled into it.
    const scale = Math.min(
      1,
      MAX_FRAME_DIM / Math.max(layout.width, layout.height)
    )
    const webp = await sharp(pngBuffer)
      .resize(Math.round(layout.width * scale), Math.round(layout.height * scale), {
        fit: "cover",
      })
      .webp({ quality: 80 })
      .toBuffer()

    const { url } = await blobStore.put(
      `thumbnails/${roomId}/${frame.id}.webp`,
      webp,
      { contentType: "image/webp", cacheControlMaxAge: 60 }
    )
    captures.set(frame.id, { url })
  }

  const manifest = buildThumbnailManifest(layouts, frames, captures)
  await setRoomThumbnailManifest(roomId, manifest)
  return manifest
}
