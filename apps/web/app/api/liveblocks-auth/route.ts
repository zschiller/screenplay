import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { liveblocks } from "@/lib/liveblocks-server"

export async function POST() {
  const session = await getCurrentSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
