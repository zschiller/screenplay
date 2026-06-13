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

// Hard ceiling on a single frame's capture. The capturers carry their own,
// finer-grained nav/ready timeouts, but a still-booting dev server can hang the
// screenshot past those; this is the orchestration's last-resort skip so one
// slow frame never blocks the round. Comfortably above the puppeteer
// capturer's internal budget so it only fires on a genuine hang.
const FRAME_CAPTURE_TIMEOUT_MS = 30_000

/** Reject `p` if it hasn't settled within `ms` — the per-frame capture ceiling. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    )
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Capture a Room's thumbnail as a per-frame composite. Reads the room's layout
 * once (`readRoomCaptureLayout`), screenshots each ready Iframe Layer's live
 * preview URL through the injected {@link ThumbnailCapturer} seam — called once
 * per frame — resizes and stores each capture, then builds and persists the
 * {@link ThumbnailManifest} on the Room row. No single baked `thumbnailUrl`
 * anymore: the grid composes positioned images from the manifest at display
 * time.
 *
 * The round degrades gracefully (#469): a frame with no preview URL, or whose
 * capture times out or throws (a still-booting dev server), is **skipped** — it
 * never blocks the round or fails the whole thumbnail, and lands in the manifest
 * as a branch-tinted placeholder. One frame failing leaves every other frame's
 * capture intact. The `sharp` resize, `BlobStore.put`, and Room write are shared
 * across capturers, so a sibling capturer (the desktop Tauri-webview one) stays
 * a drop-in.
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

    try {
      const pngBuffer = await withTimeout(
        capturer.capture(frame.previewUrl),
        FRAME_CAPTURE_TIMEOUT_MS,
        `frame ${frame.id} capture`
      )

      // Resize to the frame's own aspect ratio, capped at MAX_FRAME_DIM on the
      // long side — the manifest carries the rect, so the capture only has to
      // look right when scaled into it.
      const scale = Math.min(
        1,
        MAX_FRAME_DIM / Math.max(layout.width, layout.height)
      )
      const webp = await sharp(pngBuffer)
        .resize(
          Math.round(layout.width * scale),
          Math.round(layout.height * scale),
          { fit: "cover" }
        )
        .webp({ quality: 80 })
        .toBuffer()

      const { url } = await blobStore.put(
        `thumbnails/${roomId}/${frame.id}.webp`,
        webp,
        { contentType: "image/webp", cacheControlMaxAge: 60 }
      )
      captures.set(frame.id, { url })
    } catch (err) {
      // Skip this frame and keep going: it lands in the manifest captureless
      // (a branch-tinted placeholder) and every other frame's capture survives.
      console.warn(
        `[thumbnail] skipping frame ${frame.id} in room ${roomId}:`,
        err
      )
    }
  }

  const manifest = buildThumbnailManifest(layouts, frames, captures)
  await setRoomThumbnailManifest(roomId, manifest)
  return manifest
}
