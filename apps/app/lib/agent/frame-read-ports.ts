import "server-only"

import sharp from "sharp"

import {
  buildFrameReadTools,
  type FrameReadPorts,
} from "@/lib/agent/frame-read-tools"
import type { RoomDoc } from "@/lib/room-access"
import { getRoom } from "@/lib/rooms"
import {
  pageSnapshotScript,
  STALE_BRIDGE,
  type PageSnapshot,
} from "@/lib/sandbox-bridge/page-snapshot"
import { framePageReader, thumbnailCapturer } from "@/lib/thumbnail/capturer"

/**
 * Longest side of a `view_frame` screenshot, in pixels. Big enough to read UI
 * text, and within the size the model takes without downscaling it again.
 */
const MAX_VIEW_DIM = 1280

/** Ceiling on one live capture, as the thumbnail round's per-frame cap. */
const CAPTURE_TIMEOUT_MS = 30_000

/**
 * The frame read ports over the live Room: screenshots and page reads through
 * the Thumbnail Capturer's browser (headless Chromium hosted, the shell's
 * webview on the desktop), with the Room's stored Frame Captures behind the
 * screenshots.
 */
export function liveFrameReadPorts(roomId: string): FrameReadPorts {
  return {
    async captureFrame({ url, width, height }) {
      const png = await withTimeout(
        thumbnailCapturer.capture(url, { width, height }),
        CAPTURE_TIMEOUT_MS
      )
      const scale = Math.min(1, MAX_VIEW_DIM / Math.max(width, height))
      const data = await sharp(png)
        .resize(Math.round(width * scale), Math.round(height * scale), {
          fit: "cover",
        })
        .webp({ quality: 85 })
        .toBuffer()
      return { data, mediaType: "image/webp" }
    },

    async readFrameCapture(frameId) {
      const room = await getRoom(roomId)
      const capture = room?.thumbnailManifest?.frames.find(
        (f) => f.id === frameId
      )?.capture
      if (!capture) return null
      const res = await fetch(capture.url)
      if (!res.ok) return null
      return {
        data: Buffer.from(await res.arrayBuffer()),
        mediaType: res.headers.get("content-type") || "image/webp",
        capturedAt: capture.capturedAt,
      }
    },

    async readFramePage({ url, width, height, sandboxName }, selector) {
      const read = async () =>
        JSON.parse(
          await withTimeout(
            framePageReader.evaluate(
              url,
              { width, height },
              pageSnapshotScript(selector)
            ),
            CAPTURE_TIMEOUT_MS
          )
        ) as PageSnapshot | null
      try {
        return await read()
      } catch (err) {
        // A sandbox started before this op existed serves an older bridge.
        // Write the current one (the proxy reads it per request) and retry.
        if (!(err instanceof Error) || !err.message.includes(STALE_BRIDGE)) {
          throw err
        }
        const [{ sandboxProvider }, { writeBridgeFiles }] = await Promise.all([
          import("@/lib/sandbox"),
          import("@/lib/sandbox/provision-internals"),
        ])
        try {
          const sandbox = await sandboxProvider.get({
            name: sandboxName,
            resume: false,
          })
          await writeBridgeFiles(sandbox)
        } catch {
          throw new Error(
            "the preview’s Sandbox Bridge is out of date and couldn’t be updated"
          )
        }
        return await read()
      }
    },
  }
}

/**
 * `view_frame` and `read_frame_html` for a chat (#1311): any frame on the
 * canvas, read-only, defaulting to the frame of the Workspace running in
 * `sandboxName` when it has one. The in-process toolsets and a harness's MCP
 * server all use it.
 */
export function chatFrameReadTools(opts: {
  sandboxName?: string
  room: RoomDoc
}) {
  const { sandboxName, room } = opts
  return buildFrameReadTools(
    { ...liveFrameReadPorts(room.roomId), readDoc: (fn) => room.readDoc(fn) },
    { kind: "chat", sandboxName }
  )
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}
