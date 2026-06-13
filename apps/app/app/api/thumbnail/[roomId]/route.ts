import { after, NextResponse } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import {
  canAccess,
  getRoomThumbnailUpdatedAt,
  touchRoomThumbnailUpdatedAt,
} from "@/lib/rooms"
import { captureRoomThumbnail } from "@/lib/thumbnail/capture"
import { THUMBNAIL_CAPTURE_COOLDOWN_MS as COOLDOWN_MS } from "@/lib/thumbnail/cadence"

export const maxDuration = 60

export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params

  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await canAccess(roomId, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // The throttled heartbeat carries the dirty subset of frames to recapture
  // (#474). A missing/invalid body means a full-room capture — the initial and
  // unmount fires send none — so `frameIds` stays undefined and every ready
  // frame is captured.
  const frameIds = await readFrameIds(req)

  const updatedAt = await getRoomThumbnailUpdatedAt(roomId)
  if (updatedAt && Date.now() - updatedAt < COOLDOWN_MS) {
    return NextResponse.json({ skipped: true }, { status: 200 })
  }

  // Bump the timestamp before queueing so concurrent heartbeats dedup against
  // the in-flight capture instead of stacking duplicate jobs.
  await touchRoomThumbnailUpdatedAt(roomId)

  after(async () => {
    try {
      await captureRoomThumbnail(roomId, undefined, { frameIds })
    } catch (err) {
      console.error("[thumbnail] capture failed", err)
    }
  })

  return NextResponse.json({ queued: true }, { status: 202 })
}

/**
 * The dirty subset from the POST body, or `undefined` for a full capture.
 * Tolerant: an empty body, non-JSON, or a malformed shape all fall back to
 * `undefined` (full capture) rather than failing the heartbeat. An explicit
 * empty array is preserved — it means "rebuild the layout, capture nothing".
 */
async function readFrameIds(req: Request): Promise<string[] | undefined> {
  try {
    const body: unknown = await req.json()
    if (
      body &&
      typeof body === "object" &&
      "frameIds" in body &&
      Array.isArray((body as { frameIds: unknown }).frameIds)
    ) {
      return (body as { frameIds: unknown[] }).frameIds.filter(
        (id): id is string => typeof id === "string"
      )
    }
  } catch {
    // No body / not JSON → full capture.
  }
  return undefined
}
