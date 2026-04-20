import { auth, currentUser } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { liveblocks } from "@/lib/liveblocks-server"

export async function POST() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await currentUser()
  const name =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.username ?? "Anonymous"

  const { status, body } = await liveblocks.identifyUser(
    { userId, groupIds: [] },
    {
      userInfo: {
        name,
        avatar: user?.imageUrl,
      },
    },
  )
  return new Response(body, { status })
}
