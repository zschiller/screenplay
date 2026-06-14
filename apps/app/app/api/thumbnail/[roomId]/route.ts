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

  // The heartbeat carries the dirty subset of frames to recapture (#474). A
  // missing/invalid body means a full-room capture — the backstop and unmount
  // fires send none — so `frameIds` stays undefined and every ready frame is
  // captured. An explicit empty array is a layout-only rebuild (the layout lane:
  // a moved/renamed frame) that opens no browser.
  const frameIds = await readFrameIds(req)
  const layoutOnly = Array.isArray(frameIds) && frameIds.length === 0

  // The capture cooldown guards the expensive lane only. A layout-only rebuild
  // is cheap (a Y.Doc read + a manifest write, no browser) and must run every
  // time so the home grid's rects stay live — it neither checks nor bumps the
  // capture clock (`captureRoomThumbnail` persists it with `touch: false`).
  if (!layoutOnly) {
    const updatedAt = await getRoomThumbnailUpdatedAt(roomId)
    if (updatedAt && Date.now() - updatedAt < COOLDOWN_MS) {
      return NextResponse.json({ skipped: true }, { status: 200 })
    }

    // Bump the timestamp before queueing so concurrent captures dedup against
    // the in-flight one instead of stacking duplicate jobs.
    await touchRoomThumbnailUpdatedAt(roomId)
  }

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
