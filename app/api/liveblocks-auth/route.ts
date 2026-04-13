import { auth, currentUser } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { liveblocks } from "@/lib/liveblocks-server"

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await currentUser()
  const name =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.username ?? "Anonymous"

  const session = liveblocks.prepareSession(userId, {
    userInfo: {
      name,
      avatar: user?.imageUrl,
    },
  })

  const { room } = await req.json()
  session.allow(room, session.FULL_ACCESS)

  const { status, body } = await session.authorize()
  return new Response(body, { status })
}
