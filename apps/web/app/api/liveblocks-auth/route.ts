import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { ensureRoomBackfilled } from "@/lib/projects-actions"
import { canAccess } from "@/lib/rooms"
import { yjsHost } from "@/lib/yjs-host"

export async function POST(req: Request) {
  const session = await getCurrentSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The Liveblocks client posts `{ room }` for room-scoped tokens. When
  // present, gate on Postgres membership before issuing the token. Older
  // clients sometimes hit this without a body — fall through and let the host
  // enforce its own per-room access at connect time.
  let roomId: string | undefined
  try {
    const body = (await req.json()) as { room?: string }
    if (typeof body.room === "string" && body.room.length) roomId = body.room
  } catch {
    // No JSON body — allow.
  }

  if (roomId) {
    let allowed = await canAccess(roomId, session.user.id)
    if (!allowed) {
      // Pre-migration room? Backfill once before refusing.
      await ensureRoomBackfilled(roomId, session.user.id)
      allowed = await canAccess(roomId, session.user.id)
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const { status, body } = await yjsHost.issueToken({
    userId: session.user.id,
    userInfo: {
      name: session.user.name || "Anonymous",
      avatar: session.user.image ?? undefined,
    },
    roomId,
  })
  return new Response(body, { status })
}
