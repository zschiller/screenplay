import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { liveblocks } from "@/lib/liveblocks-server"
import { ensureRoomBackfilled } from "@/lib/projects-actions"
import { canAccess } from "@/lib/rooms"

export async function POST(req: Request) {
  const session = await getCurrentSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The Liveblocks client posts `{ room }` for room-scoped tokens. When
  // present, gate on Postgres membership before issuing the token. We accept
  // a missing room (some Liveblocks flows hit this endpoint without one) and
  // fall back to an identity-only token, which Liveblocks itself enforces
  // against per-room access.
  let roomId: string | undefined
  try {
    const body = (await req.json()) as { room?: string }
    if (typeof body.room === "string" && body.room.length) roomId = body.room
  } catch {
    // No JSON body — older Liveblocks clients sometimes do this. Allow.
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

  const { status, body } = await liveblocks.identifyUser(
    { userId: session.user.id, groupIds: [] },
    {
      userInfo: {
        name: session.user.name || "Anonymous",
        avatar: session.user.image ?? undefined,
      },
    },
  )
  return new Response(body, { status })
}
