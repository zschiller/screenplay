import { after, NextResponse } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import {
  canAccess,
  getRoomThumbnailUpdatedAt,
  touchRoomThumbnailUpdatedAt,
} from "@/lib/rooms"
import { captureRoomThumbnail } from "@/lib/thumbnail/capture"

const COOLDOWN_MS = 25_000

export const maxDuration = 60

export async function POST(
  _req: Request,
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

  const updatedAt = await getRoomThumbnailUpdatedAt(roomId)
  if (updatedAt && Date.now() - updatedAt < COOLDOWN_MS) {
    return NextResponse.json({ skipped: true }, { status: 200 })
  }

  // Bump the timestamp before queueing so concurrent heartbeats dedup against
  // the in-flight capture instead of stacking duplicate jobs.
  await touchRoomThumbnailUpdatedAt(roomId)

  after(async () => {
    try {
      await captureRoomThumbnail(roomId)
    } catch (err) {
      console.error("[thumbnail] capture failed", err)
    }
  })

  return NextResponse.json({ queued: true }, { status: 202 })
}
