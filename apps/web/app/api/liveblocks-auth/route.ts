import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth-server"
import { liveblocks } from "@/lib/liveblocks-server"

export async function POST() {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: userId, name, image } = session.user
  const displayName = name?.trim() || session.user.email || "Anonymous"

  const { status, body } = await liveblocks.identifyUser(
    { userId, groupIds: [] },
    {
      userInfo: {
        name: displayName,
        avatar: image ?? undefined,
      },
    },
  )
  return new Response(body, { status })
}
